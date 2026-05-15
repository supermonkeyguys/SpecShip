package runtime

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/supermonkeyguys/specship/apps/server-go/internal/domain"
	"github.com/supermonkeyguys/specship/apps/server-go/internal/infra/llm"
	"github.com/supermonkeyguys/specship/apps/server-go/internal/infra/toolrunner"
)

type Verifier interface {
	VerifyNode(ctx context.Context, g *domain.Graph, node *domain.Node) (*VerificationOutcome, error)
}

type VerificationOutcome struct {
	Passed         bool
	Records        []domain.VerificationRecord
	FailureSummary string
}

type BasicVerifier struct {
	ToolRunner toolrunner.Client
	Reviewer   llm.Client
	Model      string
	Workspace  string
}

func NewBasicVerifier(runner toolrunner.Client, reviewer llm.Client, model string, workspace string) *BasicVerifier {
	return &BasicVerifier{
		ToolRunner: runner,
		Reviewer:   reviewer,
		Model:      model,
		Workspace:  workspace,
	}
}

func (v *BasicVerifier) VerifyNode(ctx context.Context, g *domain.Graph, node *domain.Node) (*VerificationOutcome, error) {
	_ = g

	presenceRecord, err := v.verifyOutputPresence(ctx, node)
	if err != nil {
		return nil, err
	}

	records := []domain.VerificationRecord{presenceRecord}
	if !presenceRecord.Passed {
		return &VerificationOutcome{Passed: false, Records: records, FailureSummary: presenceRecord.Output}, nil
	}

	deterministicRecords, failureSummary, err := v.runDeterministicChecks(ctx, node)
	if err != nil {
		return nil, err
	}
	records = append(records, deterministicRecords...)
	if strings.TrimSpace(failureSummary) != "" {
		return &VerificationOutcome{Passed: false, Records: records, FailureSummary: failureSummary}, nil
	}

	if v.Reviewer == nil || strings.TrimSpace(v.Model) == "" || len(node.Outputs) == 0 {
		return &VerificationOutcome{Passed: true, Records: records}, nil
	}

	reviewRecord, err := v.runReviewerCheck(ctx, node)
	if err != nil {
		return nil, err
	}
	records = append(records, reviewRecord)
	if !reviewRecord.Passed {
		return &VerificationOutcome{Passed: false, Records: records, FailureSummary: reviewRecord.Output}, nil
	}

	return &VerificationOutcome{Passed: true, Records: records}, nil
}

func (v *BasicVerifier) verifyOutputPresence(ctx context.Context, node *domain.Node) (domain.VerificationRecord, error) {
	started := time.Now().UTC()
	missing := make([]string, 0)

	for _, output := range node.Outputs {
		resp, err := v.ToolRunner.ReadFile(ctx, toolrunner.ReadFileRequest{RelativePath: output})
		if err != nil || resp == nil || !resp.Success || strings.TrimSpace(resp.Output) == "" {
			switch {
			case err != nil:
				missing = append(missing, fmt.Sprintf("%s (%s)", output, err.Error()))
			case resp != nil && !resp.Success:
				missing = append(missing, fmt.Sprintf("%s (%s)", output, strings.TrimSpace(resp.Output)))
			default:
				missing = append(missing, fmt.Sprintf("%s (missing or empty)", output))
			}
		}
	}

	if len(missing) > 0 {
		return verificationRecord("artifact", false, "missing outputs: "+strings.Join(missing, "; "), started), nil
	}
	return verificationRecord("artifact", true, fmt.Sprintf("verified %d output file(s)", len(node.Outputs)), started), nil
}

func (v *BasicVerifier) runDeterministicChecks(ctx context.Context, node *domain.Node) ([]domain.VerificationRecord, string, error) {
	files := dedupeStrings(node.Outputs)
	if len(files) == 0 {
		return []domain.VerificationRecord{verificationRecord("compile", true, "node has no declared output files; compile checks skipped", time.Now().UTC())}, "", nil
	}

	records := make([]domain.VerificationRecord, 0, 8)
	projectRecords, projectFailure, handled, err := v.runProjectAwareChecks(ctx, files)
	if err != nil {
		return nil, "", err
	}
	if handled {
		records = append(records, projectRecords...)
		if strings.TrimSpace(projectFailure) != "" {
			return records, projectFailure, nil
		}
		return records, "", nil
	}

	buckets := classifyOutputs(files)

	if len(buckets.TypeScript) > 0 {
		record, err := v.runTypeScriptCompile(ctx, buckets.TypeScript)
		if err != nil {
			return nil, "", err
		}
		records = append(records, record)
		if !record.Passed {
			return records, record.Output, nil
		}
	}

	if len(buckets.JavaScript) > 0 {
		for _, file := range buckets.JavaScript {
			record, err := v.runCommandCheck(ctx, "compile", []string{file}, commandSpec{
				Program:   "node",
				Args:      []string{"--check", file},
				WorkDir:   v.workspaceDir(),
				TimeoutMs: 30_000,
				Summary:   fmt.Sprintf("node --check %s", file),
			})
			if err != nil {
				return nil, "", err
			}
			records = append(records, record)
			if !record.Passed {
				return records, record.Output, nil
			}
		}
	}

	goRecords, goFailure, err := v.runGoChecks(ctx, buckets.Go)
	if err != nil {
		return nil, "", err
	}
	records = append(records, goRecords...)
	if strings.TrimSpace(goFailure) != "" {
		return records, goFailure, nil
	}

	pythonRecords, pythonFailure, err := v.runPythonChecks(ctx, buckets.Python)
	if err != nil {
		return nil, "", err
	}
	records = append(records, pythonRecords...)
	if strings.TrimSpace(pythonFailure) != "" {
		return records, pythonFailure, nil
	}

	lintRecord, err := v.runOptionalLint(ctx, files)
	if err != nil {
		return nil, "", err
	}
	records = append(records, lintRecord)
	if !lintRecord.Passed {
		return records, lintRecord.Output, nil
	}

	if len(records) == 0 {
		records = append(records, verificationRecord("compile", true, "no language-specific compile checks were applicable", time.Now().UTC()))
	}
	return records, "", nil
}

type outputBuckets struct {
	TypeScript []string
	JavaScript []string
	Go         []string
	Python     []string
	Other      []string
}

type projectCommand struct {
	Type        string
	Program     string
	Args        []string
	Summary     string
	WorkDir     string
	TimeoutMs   int
	Required    bool
	SoftFailure bool
}

type packageJSON struct {
	Scripts map[string]string `json:"scripts"`
}

func classifyOutputs(files []string) outputBuckets {
	var buckets outputBuckets
	for _, file := range files {
		switch strings.ToLower(filepath.Ext(file)) {
		case ".ts", ".tsx", ".cts", ".mts":
			buckets.TypeScript = append(buckets.TypeScript, file)
		case ".js", ".jsx", ".cjs", ".mjs":
			buckets.JavaScript = append(buckets.JavaScript, file)
		case ".go":
			buckets.Go = append(buckets.Go, file)
		case ".py":
			buckets.Python = append(buckets.Python, file)
		default:
			buckets.Other = append(buckets.Other, file)
		}
	}
	return buckets
}

func (v *BasicVerifier) runProjectAwareChecks(ctx context.Context, files []string) ([]domain.VerificationRecord, string, bool, error) {
	pkgRoot, pkgPath, ok := findNearestPackageJSONForOutputs(v.workspaceDir(), files)
	if !ok {
		return nil, "", false, nil
	}

	pkg, err := readPackageJSON(pkgPath)
	if err != nil {
		return []domain.VerificationRecord{verificationRecord("compile", true, fmt.Sprintf("package.json found at %s but could not be parsed; falling back to extension-based checks", filepath.ToSlash(relativeOrSelf(v.workspaceDir(), pkgPath))), time.Now().UTC())}, "", false, nil
	}

	packageManager, ok := detectPackageManager(pkgRoot)
	if !ok {
		return []domain.VerificationRecord{verificationRecord("compile", true, fmt.Sprintf("package.json found at %s but no package manager detected; falling back to extension-based checks", filepath.ToSlash(relativeOrSelf(v.workspaceDir(), pkgRoot))), time.Now().UTC())}, "", false, nil
	}

	commands := buildProjectCommands(pkgRoot, packageManager, pkg)
	if len(commands) == 0 {
		return []domain.VerificationRecord{verificationRecord("compile", true, fmt.Sprintf("package.json found at %s but no useful project scripts discovered; falling back to extension-based checks", filepath.ToSlash(relativeOrSelf(v.workspaceDir(), pkgRoot))), time.Now().UTC())}, "", false, nil
	}

	records := make([]domain.VerificationRecord, 0, len(commands)+1)
	records = append(records, verificationRecord("compile", true, fmt.Sprintf("project-aware verification enabled in %s using %s", filepath.ToSlash(relativeOrSelf(v.workspaceDir(), pkgRoot)), packageManager), time.Now().UTC()))

	for _, cmd := range commands {
		record, err := v.runCommandCheck(ctx, cmd.Type, files, commandSpec{
			Program:   cmd.Program,
			Args:      cmd.Args,
			WorkDir:   cmd.WorkDir,
			TimeoutMs: cmd.TimeoutMs,
			Summary:   cmd.Summary,
		})
		if err != nil {
			return nil, "", true, err
		}
		if record.Passed {
			record = enrichSuccessfulOutput(record, cmd.Summary)
			records = append(records, record)
			continue
		}

		if cmd.SoftFailure {
			records = append(records, record)
			continue
		}

		records = append(records, record)
		if cmd.Required {
			return records, record.Output, true, nil
		}
	}

	return records, "", true, nil
}

func buildProjectCommands(pkgRoot string, packageManager string, pkg packageJSON) []projectCommand {
	commands := make([]projectCommand, 0, 4)
	addScript := func(script string, recordType string, required bool, softFailure bool, timeout int) {
		if strings.TrimSpace(pkg.Scripts[script]) == "" {
			return
		}
		commands = append(commands, projectCommand{
			Type:        recordType,
			Program:     packageManager,
			Args:        packageManagerRunArgs(packageManager, script),
			Summary:     fmt.Sprintf("%s %s", packageManager, strings.Join(packageManagerRunArgs(packageManager, script), " ")),
			WorkDir:     pkgRoot,
			TimeoutMs:   timeout,
			Required:    required,
			SoftFailure: softFailure,
		})
	}

	addScript("build", "compile", true, false, 120_000)
	addScript("test", "test", false, false, 120_000)
	addScript("lint", "lint", false, true, 90_000)

	if len(commands) > 0 {
		return commands
	}

	if hasLikelyTypeScriptConfig(pkgRoot) {
		commands = append(commands, projectCommand{
			Type:      "compile",
			Program:   packageManager,
			Args:      packageManagerExecArgs(packageManager, []string{"tsc", "--noEmit"}),
			Summary:   fmt.Sprintf("%s %s", packageManager, strings.Join(packageManagerExecArgs(packageManager, []string{"tsc", "--noEmit"}), " ")),
			WorkDir:   pkgRoot,
			TimeoutMs: 60_000,
			Required:  true,
		})
	}

	return commands
}

func packageManagerRunArgs(packageManager string, script string) []string {
	switch packageManager {
	case "pnpm":
		return []string{"run", script}
	case "yarn":
		return []string{script}
	default:
		return []string{"run", script}
	}
}

func packageManagerExecArgs(packageManager string, command []string) []string {
	switch packageManager {
	case "pnpm":
		return append([]string{"exec"}, command...)
	case "yarn":
		return append([]string{"exec"}, command...)
	default:
		return append([]string{"exec", "--"}, command...)
	}
}

func hasLikelyTypeScriptConfig(root string) bool {
	for _, name := range []string{"tsconfig.json", "tsconfig.app.json", "tsconfig.build.json"} {
		if fileExists(filepath.Join(root, name)) {
			return true
		}
	}
	return false
}

func detectPackageManager(root string) (string, bool) {
	if fileExists(filepath.Join(root, "pnpm-lock.yaml")) {
		if _, err := exec.LookPath("pnpm"); err == nil {
			return "pnpm", true
		}
	}
	if fileExists(filepath.Join(root, "yarn.lock")) {
		if _, err := exec.LookPath("yarn"); err == nil {
			return "yarn", true
		}
	}
	if fileExists(filepath.Join(root, "package-lock.json")) {
		if _, err := exec.LookPath("npm"); err == nil {
			return "npm", true
		}
	}
	if _, err := exec.LookPath("pnpm"); err == nil {
		return "pnpm", true
	}
	if _, err := exec.LookPath("npm"); err == nil {
		return "npm", true
	}
	return "", false
}

func readPackageJSON(path string) (packageJSON, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return packageJSON{}, err
	}
	var parsed packageJSON
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return packageJSON{}, err
	}
	if parsed.Scripts == nil {
		parsed.Scripts = map[string]string{}
	}
	return parsed, nil
}

func findNearestPackageJSONForOutputs(workspace string, files []string) (string, string, bool) {
	roots := map[string]string{}
	for _, file := range files {
		full := filepath.Join(workspace, file)
		root, ok := findNearestFile(full, "package.json")
		if !ok {
			continue
		}
		pkgPath := filepath.Join(root, "package.json")
		roots[root] = pkgPath
	}
	if len(roots) == 0 {
		return "", "", false
	}
	ordered := make([]string, 0, len(roots))
	for root := range roots {
		ordered = append(ordered, root)
	}
	sort.Strings(ordered)
	root := ordered[0]
	return root, roots[root], true
}

func relativeOrSelf(base string, target string) string {
	rel, err := filepath.Rel(base, target)
	if err != nil {
		return target
	}
	return rel
}

func (v *BasicVerifier) runTypeScriptCompile(ctx context.Context, files []string) (domain.VerificationRecord, error) {
	started := time.Now().UTC()
	workspace := v.workspaceDir()
	compiler, ok := findTypeScriptCompiler(workspace)
	if !ok {
		return verificationRecord("compile", true, fmt.Sprintf("TypeScript compiler not found; skipped typecheck for %d file(s)", len(files)), started), nil
	}

	tsconfigPath, cleanup, err := v.writeTempTSConfig(files)
	if err != nil {
		return domain.VerificationRecord{}, err
	}
	defer cleanup()

	args := append([]string{}, compiler.ArgsPrefix...)
	args = append(args, "--noEmit", "--project", filepath.Base(tsconfigPath))

	record, err := v.runCommandCheck(ctx, "compile", files, commandSpec{
		Program:   compiler.Program,
		Args:      args,
		WorkDir:   workspace,
		TimeoutMs: 45_000,
		Summary:   compiler.Summary,
	})
	if err != nil {
		return domain.VerificationRecord{}, err
	}
	return enrichSuccessfulOutput(record, fmt.Sprintf("typechecked %d TypeScript file(s)", len(files))), nil
}

func (v *BasicVerifier) runGoChecks(ctx context.Context, files []string) ([]domain.VerificationRecord, string, error) {
	if len(files) == 0 {
		return nil, "", nil
	}
	if _, err := exec.LookPath("go"); err != nil {
		return []domain.VerificationRecord{verificationRecord("test", true, fmt.Sprintf("Go toolchain not found; skipped go verification for %d file(s)", len(files)), time.Now().UTC())}, "", nil
	}

	roots := map[string][]string{}
	missingModule := make([]string, 0)
	for _, file := range files {
		moduleRoot, ok := findNearestFile(filepath.Join(v.workspaceDir(), file), "go.mod")
		if !ok {
			missingModule = append(missingModule, file)
			continue
		}
		roots[moduleRoot] = append(roots[moduleRoot], file)
	}

	records := make([]domain.VerificationRecord, 0, len(roots)+1)
	if len(missingModule) > 0 {
		sort.Strings(missingModule)
		records = append(records, verificationRecord("compile", true, fmt.Sprintf("go.mod not found; skipped go compile for: %s", strings.Join(missingModule, ", ")), time.Now().UTC()))
	}

	orderedRoots := make([]string, 0, len(roots))
	for root := range roots {
		orderedRoots = append(orderedRoots, root)
	}
	sort.Strings(orderedRoots)

	for _, root := range orderedRoots {
		filesForRoot := roots[root]
		record, err := v.runCommandCheck(ctx, "test", filesForRoot, commandSpec{
			Program:   "go",
			Args:      []string{"test", "./..."},
			WorkDir:   root,
			TimeoutMs: 60_000,
			Summary:   fmt.Sprintf("go test ./... (in %s)", filepath.Base(root)),
		})
		if err != nil {
			return nil, "", err
		}
		record = enrichSuccessfulOutput(record, fmt.Sprintf("validated Go package(s) for %d file(s)", len(filesForRoot)))
		records = append(records, record)
		if !record.Passed {
			return records, record.Output, nil
		}
	}

	return records, "", nil
}

func (v *BasicVerifier) runPythonChecks(ctx context.Context, files []string) ([]domain.VerificationRecord, string, error) {
	if len(files) == 0 {
		return nil, "", nil
	}

	pythonProgram, ok := findPythonProgram()
	if !ok {
		return []domain.VerificationRecord{verificationRecord("compile", true, fmt.Sprintf("Python interpreter not found; skipped py_compile for %d file(s)", len(files)), time.Now().UTC())}, "", nil
	}

	args := append([]string{"-m", "py_compile"}, files...)
	record, err := v.runCommandCheck(ctx, "compile", files, commandSpec{
		Program:   pythonProgram,
		Args:      args,
		WorkDir:   v.workspaceDir(),
		TimeoutMs: 30_000,
		Summary:   fmt.Sprintf("%s -m py_compile", filepath.Base(pythonProgram)),
	})
	if err != nil {
		return nil, "", err
	}
	record = enrichSuccessfulOutput(record, fmt.Sprintf("byte-compiled %d Python file(s)", len(files)))
	if !record.Passed {
		return []domain.VerificationRecord{record}, record.Output, nil
	}
	return []domain.VerificationRecord{record}, "", nil
}

func (v *BasicVerifier) runOptionalLint(ctx context.Context, files []string) (domain.VerificationRecord, error) {
	lintable := make([]string, 0)
	for _, file := range files {
		switch strings.ToLower(filepath.Ext(file)) {
		case ".ts", ".tsx", ".cts", ".mts", ".js", ".jsx", ".cjs", ".mjs":
			lintable = append(lintable, file)
		}
	}
	if len(lintable) == 0 {
		return verificationRecord("lint", true, "no JS/TS files detected; lint skipped", time.Now().UTC()), nil
	}

	command, ok := findESLintCommand(v.workspaceDir())
	if !ok {
		return verificationRecord("lint", true, fmt.Sprintf("eslint not found; skipped lint for %d file(s)", len(lintable)), time.Now().UTC()), nil
	}

	args := append([]string{}, command.ArgsPrefix...)
	args = append(args, lintable...)
	record, err := v.runCommandCheck(ctx, "lint", lintable, commandSpec{
		Program:   command.Program,
		Args:      args,
		WorkDir:   v.workspaceDir(),
		TimeoutMs: 45_000,
		Summary:   command.Summary,
	})
	if err != nil {
		return domain.VerificationRecord{}, err
	}
	return enrichSuccessfulOutput(record, fmt.Sprintf("linted %d JS/TS file(s)", len(lintable))), nil
}

func (v *BasicVerifier) runReviewerCheck(ctx context.Context, node *domain.Node) (domain.VerificationRecord, error) {
	started := time.Now().UTC()
	firstOutput := node.Outputs[0]
	fileResp, err := v.ToolRunner.ReadFile(ctx, toolrunner.ReadFileRequest{RelativePath: firstOutput})
	if err != nil {
		return domain.VerificationRecord{}, err
	}

	reviewPrompt := fmt.Sprintf(
		"File: %s\nAcceptance: %s\nTask: %s\n\nCode:\n%s",
		filepath.ToSlash(firstOutput),
		node.AcceptanceCriteria,
		node.Task,
		fileResp.Output,
	)
	reviewOut, err := v.Reviewer.Run(ctx, llm.RunInput{
		SystemPrompt: domain.ReviewerPrompt,
		UserPrompt:   reviewPrompt,
		Model:        v.Model,
		WithTools:    false,
	})
	if err != nil {
		return domain.VerificationRecord{}, err
	}

	passed, summary := parseReviewResult(reviewOut.FinalText)
	return verificationRecord("review", passed, summary, started), nil
}

type commandSpec struct {
	Program   string
	Args      []string
	WorkDir   string
	TimeoutMs int
	Summary   string
}

func (v *BasicVerifier) runCommandCheck(ctx context.Context, recordType string, files []string, spec commandSpec) (domain.VerificationRecord, error) {
	started := time.Now().UTC()
	resp, err := v.ToolRunner.RunCommand(ctx, toolrunner.RunCommandRequest{
		Program:   spec.Program,
		Args:      spec.Args,
		WorkDir:   spec.WorkDir,
		TimeoutMs: spec.TimeoutMs,
	})
	if err != nil {
		return domain.VerificationRecord{}, err
	}

	output := strings.TrimSpace(strings.Join(filterNonEmpty(
		fmt.Sprintf("command: %s", strings.TrimSpace(spec.Summary)),
		fmt.Sprintf("files: %s", strings.Join(files, ", ")),
		trimOutput(resp.Stdout),
		trimOutput(resp.Stderr),
	), "\n"))
	if output == "" {
		output = fmt.Sprintf("command: %s", spec.Summary)
	}

	return verificationRecord(recordType, resp.Success && resp.ExitCode == 0, output, started), nil
}

func (v *BasicVerifier) writeTempTSConfig(files []string) (string, func(), error) {
	workspace := v.workspaceDir()
	if err := os.MkdirAll(workspace, 0o755); err != nil {
		return "", nil, err
	}

	relFiles := make([]string, 0, len(files))
	hasTSX := false
	for _, file := range files {
		cleaned := filepath.Clean(file)
		relFiles = append(relFiles, filepath.ToSlash(cleaned))
		if strings.EqualFold(filepath.Ext(cleaned), ".tsx") {
			hasTSX = true
		}
	}

	payload := map[string]any{
		"compilerOptions": map[string]any{
			"noEmit":           true,
			"target":           "ES2022",
			"module":           "ESNext",
			"moduleResolution": "Bundler",
			"esModuleInterop":  true,
			"skipLibCheck":     true,
		},
		"files": relFiles,
	}
	if hasTSX {
		payload["compilerOptions"].(map[string]any)["jsx"] = "react-jsx"
		payload["compilerOptions"].(map[string]any)["allowImportingTsExtensions"] = true
	}

	raw, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return "", nil, err
	}

	handle, err := os.CreateTemp(workspace, ".shipyard-verify-*.tsconfig.json")
	if err != nil {
		return "", nil, err
	}
	path := handle.Name()
	if _, err := handle.Write(raw); err != nil {
		_ = handle.Close()
		_ = os.Remove(path)
		return "", nil, err
	}
	if err := handle.Close(); err != nil {
		_ = os.Remove(path)
		return "", nil, err
	}

	cleanup := func() { _ = os.Remove(path) }
	return path, cleanup, nil
}

func (v *BasicVerifier) workspaceDir() string {
	if strings.TrimSpace(v.Workspace) != "" {
		return v.Workspace
	}
	if local, ok := v.ToolRunner.(*toolrunner.LocalClient); ok && strings.TrimSpace(local.RootDir) != "" {
		return local.RootDir
	}
	return "."
}

type executableCommand struct {
	Program    string
	ArgsPrefix []string
	Summary    string
}

func findTypeScriptCompiler(workspace string) (executableCommand, bool) {
	for _, dir := range walkAncestors(workspace) {
		candidate := filepath.Join(dir, "node_modules", "typescript", "bin", "tsc")
		if fileExists(candidate) {
			return executableCommand{
				Program:    "node",
				ArgsPrefix: []string{candidate},
				Summary:    "node node_modules/typescript/bin/tsc",
			}, true
		}
	}
	if path, err := exec.LookPath("tsc"); err == nil {
		return executableCommand{Program: path, Summary: filepath.Base(path)}, true
	}
	return executableCommand{}, false
}

func findESLintCommand(workspace string) (executableCommand, bool) {
	for _, dir := range walkAncestors(workspace) {
		candidate := filepath.Join(dir, "node_modules", ".bin", "eslint")
		if fileExists(candidate) {
			return executableCommand{Program: candidate, Summary: filepath.ToSlash(candidate)}, true
		}
	}
	if path, err := exec.LookPath("eslint"); err == nil {
		return executableCommand{Program: path, Summary: filepath.Base(path)}, true
	}
	return executableCommand{}, false
}

func findPythonProgram() (string, bool) {
	for _, name := range []string{"python3", "python"} {
		if path, err := exec.LookPath(name); err == nil {
			return path, true
		}
	}
	return "", false
}

func walkAncestors(start string) []string {
	abs, err := filepath.Abs(start)
	if err != nil {
		abs = start
	}
	dirs := []string{}
	current := filepath.Clean(abs)
	seen := map[string]struct{}{}
	for {
		if _, ok := seen[current]; ok {
			break
		}
		seen[current] = struct{}{}
		dirs = append(dirs, current)
		parent := filepath.Dir(current)
		if parent == current {
			break
		}
		current = parent
	}
	return dirs
}

func findNearestFile(startPath string, targetName string) (string, bool) {
	current := filepath.Clean(startPath)
	if info, err := os.Stat(current); err == nil && !info.IsDir() {
		current = filepath.Dir(current)
	}
	for {
		candidate := filepath.Join(current, targetName)
		if fileExists(candidate) {
			return current, true
		}
		parent := filepath.Dir(current)
		if parent == current {
			break
		}
		current = parent
	}
	return "", false
}

func parseReviewResult(text string) (bool, string) {
	start := strings.Index(text, "{")
	end := strings.LastIndex(text, "}")
	if start < 0 || end <= start {
		trimmed := strings.TrimSpace(text)
		if trimmed == "" {
			return false, "reviewer returned empty response"
		}
		return false, trimmed
	}
	raw := text[start : end+1]
	var parsed struct {
		Passed   bool     `json:"passed"`
		Blocking []string `json:"blocking"`
		Summary  string   `json:"summary"`
	}
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		return false, err.Error()
	}
	if parsed.Passed {
		return true, firstNonEmpty(parsed.Summary, "review passed")
	}
	if len(parsed.Blocking) > 0 {
		return false, strings.Join(parsed.Blocking, "; ")
	}
	return false, firstNonEmpty(parsed.Summary, "review failed")
}

func verificationRecord(recordType string, passed bool, output string, started time.Time) domain.VerificationRecord {
	now := time.Now().UTC()
	return domain.VerificationRecord{
		Type:       recordType,
		Passed:     passed,
		Output:     strings.TrimSpace(output),
		DurationMs: now.Sub(started).Milliseconds(),
		At:         now,
	}
}

func enrichSuccessfulOutput(record domain.VerificationRecord, summary string) domain.VerificationRecord {
	if !record.Passed {
		return record
	}
	record.Output = strings.TrimSpace(firstNonEmpty(summary, record.Output))
	return record
}

func trimOutput(s string) string {
	trimmed := strings.TrimSpace(s)
	if trimmed == "" {
		return ""
	}
	if len(trimmed) > 1200 {
		return trimmed[:1200] + "\n...(truncated)"
	}
	return trimmed
}

func dedupeStrings(values []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		cleaned := filepath.ToSlash(filepath.Clean(value))
		if _, ok := seen[cleaned]; ok {
			continue
		}
		seen[cleaned] = struct{}{}
		out = append(out, cleaned)
	}
	sort.Strings(out)
	return out
}

func filterNonEmpty(values ...string) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}
