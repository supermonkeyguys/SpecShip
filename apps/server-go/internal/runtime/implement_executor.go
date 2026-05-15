package runtime

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/supermonkeyguys/specship/apps/server-go/internal/domain"
	"github.com/supermonkeyguys/specship/apps/server-go/internal/infra/llm"
	"github.com/supermonkeyguys/specship/apps/server-go/internal/infra/toolrunner"
)

type LLMImplementExecutor struct {
	Client           llm.Client
	ToolRunner       toolrunner.Client
	Model            string
	Workspace        string
	MaxSteps         int
	CommandTimeoutMs int
}

func NewLLMImplementExecutor(client llm.Client, runner toolrunner.Client, model string, workspace string) *LLMImplementExecutor {
	return &LLMImplementExecutor{
		Client:           client,
		ToolRunner:       runner,
		Model:            model,
		Workspace:        workspace,
		MaxSteps:         8,
		CommandTimeoutMs: 30_000,
	}
}

type executorAction struct {
	Action    string   `json:"action"`
	Thought   string   `json:"thought"`
	Path      string   `json:"path"`
	Pattern   string   `json:"pattern"`
	Glob      string   `json:"glob"`
	Content   string   `json:"content"`
	Program   string   `json:"program"`
	Args      []string `json:"args"`
	WorkDir   string   `json:"workDir"`
	TimeoutMs int      `json:"timeoutMs"`
	Summary   string   `json:"summary"`
}

type executorHistoryEntry struct {
	Step         int
	AssistantRaw string
	Observation  string
}

type executorState struct {
	History       []executorHistoryEntry
	ToolCalls     []domain.ToolCall
	Verifications []domain.VerificationRecord
}

func (e *LLMImplementExecutor) ExecuteNode(ctx context.Context, g *domain.Graph, node *domain.Node) (*ExecutionResult, error) {
	if e.Client == nil {
		return nil, fmt.Errorf("llm client is required")
	}
	if e.ToolRunner == nil {
		return nil, fmt.Errorf("tool runner is required")
	}
	if len(node.Outputs) == 0 {
		return nil, fmt.Errorf("node has no outputs")
	}

	started := time.Now().UTC()
	state := &executorState{
		History:       []executorHistoryEntry{},
		ToolCalls:     []domain.ToolCall{},
		Verifications: []domain.VerificationRecord{},
	}

	dependencyContext := e.buildDependencyContext(ctx, g, node)
	currentOutputs := e.buildCurrentOutputContext(ctx, node)

	for step := 1; step <= e.maxSteps(); step++ {
		prompt := e.buildLoopPrompt(node, dependencyContext, currentOutputs, state, step)
		llmOut, err := e.Client.Run(ctx, llm.RunInput{
			SystemPrompt: domain.ImplementerLoopPrompt,
			UserPrompt:   prompt,
			Model:        e.Model,
			WithTools:    false,
		})
		if err != nil {
			return nil, err
		}

		action, err := parseExecutorAction(llmOut.FinalText)
		if err != nil {
			state.History = append(state.History, executorHistoryEntry{
				Step:         step,
				AssistantRaw: trimExecutorText(llmOut.FinalText, 2400),
				Observation:  fmt.Sprintf("Invalid response: %s. Reply with exactly one JSON object using one of: read_file, search_files, write_file, run_command, finish.", err.Error()),
			})
			continue
		}

		if strings.EqualFold(action.Action, "finish") {
			ready, reason := e.canFinish(ctx, node)
			if !ready {
				state.History = append(state.History, executorHistoryEntry{
					Step:         step,
					AssistantRaw: trimExecutorText(llmOut.FinalText, 2400),
					Observation:  "Finish rejected: " + reason,
				})
				continue
			}

			verifyOutcome, verifySummary, err := e.runAutoVerify(ctx, node, state)
			if err != nil {
				return nil, err
			}
			if !verifyOutcome.Passed {
				state.History = append(state.History, executorHistoryEntry{
					Step:         step,
					AssistantRaw: trimExecutorText(llmOut.FinalText, 2400),
					Observation:  "Finish blocked by automatic verification:\n" + trimExecutorText(verifySummary, 2400),
				})
				currentOutputs = e.buildCurrentOutputContext(ctx, node)
				continue
			}

			completed := time.Now().UTC()
			filesWritten, err := e.collectOutputFiles(ctx, node)
			if err != nil {
				return nil, err
			}
			evidence := &domain.Evidence{
				ModelUsed:     e.Model,
				ToolCalls:     append([]domain.ToolCall{}, state.ToolCalls...),
				FilesWritten:  filesWritten,
				Verifications: append([]domain.VerificationRecord{}, state.Verifications...),
				StartedAt:     started,
				CompletedAt:   &completed,
				DurationMs:    completed.Sub(started).Milliseconds(),
			}
			return &ExecutionResult{Evidence: evidence}, nil
		}

		toolCall, observation := e.executeAction(ctx, node, *action)
		toolCall.At = time.Now().UTC()
		state.ToolCalls = append(state.ToolCalls, toolCall)

		fullObservation := observation
		if toolCall.Tool == "write_file" && toolCall.Success {
			_, verifySummary, err := e.runAutoVerify(ctx, node, state)
			if err != nil {
				return nil, err
			}
			fullObservation = strings.TrimSpace(fullObservation + "\n\nAutomatic verification:\n" + verifySummary)
		}

		state.History = append(state.History, executorHistoryEntry{
			Step:         step,
			AssistantRaw: trimExecutorText(llmOut.FinalText, 2400),
			Observation:  trimExecutorText(fullObservation, 2400),
		})
		currentOutputs = e.buildCurrentOutputContext(ctx, node)
	}

	return nil, fmt.Errorf("executor reached max steps (%d) without finishing", e.maxSteps())
}

func (e *LLMImplementExecutor) buildLoopPrompt(node *domain.Node, dependencyContext string, currentOutputs string, state *executorState, step int) string {
	return fmt.Sprintf(
		"Step: %d/%d\nRole: %s\nTask: %s\nAcceptance: %s\nAllowed output files: %s\nWorkspace root: %s\n\nDependency context:\n%s\n\nCurrent output snapshots:\n%s\n\nPrevious error context:\n%s\n\nLatest verification status:\n%s\n\nExecution history:\n%s\n\nReturn exactly one JSON object with one action. Valid actions:\n1. {\"action\":\"read_file\",\"path\":\"relative/path\",\"thought\":\"why\"}\n2. {\"action\":\"search_files\",\"pattern\":\"text to search\",\"glob\":\"optional\",\"thought\":\"why\"}\n3. {\"action\":\"write_file\",\"path\":\"relative/path\",\"content\":\"full file content\",\"thought\":\"why\"}\n4. {\"action\":\"run_command\",\"program\":\"pnpm\",\"args\":[\"test\"],\"workDir\":\"optional/relative/dir\",\"timeoutMs\":30000,\"thought\":\"why\"}\n5. {\"action\":\"finish\",\"summary\":\"what was implemented and why it should pass\"}\n\nRules:\n- Output JSON only, no markdown fences.\n- Use only one action per turn.\n- Read/search before writing when context is unclear.\n- write_file must target one of the allowed output files exactly.\n- run_command must stay inside the workspace root.\n- The system may automatically run compile/lint/test verification after writes and before finish. Use those results to repair the code.\n- Do not call finish until every required output file exists, is non-empty, and automatic verification is likely to pass.\n",
		step,
		e.maxSteps(),
		node.Role,
		node.Task,
		node.AcceptanceCriteria,
		strings.Join(node.Outputs, ", "),
		e.workspaceDir(),
		firstNonEmpty(dependencyContext, "(none)"),
		firstNonEmpty(currentOutputs, "(none)"),
		firstNonEmpty(node.LastError, "(none)"),
		buildVerificationSummary(state.Verifications),
		buildHistoryTranscript(state.History),
	)
}

func (e *LLMImplementExecutor) executeAction(ctx context.Context, node *domain.Node, action executorAction) (domain.ToolCall, string) {
	inputJSON := mustMarshalAction(action)
	switch strings.ToLower(strings.TrimSpace(action.Action)) {
	case "read_file":
		if strings.TrimSpace(action.Path) == "" {
			return domain.ToolCall{Tool: "read_file", InputJSON: inputJSON, Output: "path is required", Success: false}, "read_file failed: path is required"
		}
		resp, err := e.ToolRunner.ReadFile(ctx, toolrunner.ReadFileRequest{RelativePath: action.Path})
		if err != nil {
			return domain.ToolCall{Tool: "read_file", InputJSON: inputJSON, Output: err.Error(), Success: false}, "read_file failed: " + err.Error()
		}
		observation := firstNonEmpty(resp.Output, "(empty file)")
		return domain.ToolCall{Tool: "read_file", InputJSON: inputJSON, Output: trimExecutorText(observation, 4000), Success: resp.Success}, "read_file result:\n" + trimExecutorText(observation, 4000)

	case "search_files":
		if strings.TrimSpace(action.Pattern) == "" {
			return domain.ToolCall{Tool: "search_files", InputJSON: inputJSON, Output: "pattern is required", Success: false}, "search_files failed: pattern is required"
		}
		resp, err := e.ToolRunner.SearchFiles(ctx, toolrunner.SearchFilesRequest{Pattern: action.Pattern, Glob: action.Glob})
		if err != nil {
			return domain.ToolCall{Tool: "search_files", InputJSON: inputJSON, Output: err.Error(), Success: false}, "search_files failed: " + err.Error()
		}
		observation := firstNonEmpty(resp.Output, "(no matches)")
		return domain.ToolCall{Tool: "search_files", InputJSON: inputJSON, Output: trimExecutorText(observation, 4000), Success: resp.Success}, "search_files result:\n" + trimExecutorText(observation, 4000)

	case "write_file":
		if strings.TrimSpace(action.Path) == "" {
			return domain.ToolCall{Tool: "write_file", InputJSON: inputJSON, Output: "path is required", Success: false}, "write_file failed: path is required"
		}
		if strings.TrimSpace(action.Content) == "" {
			return domain.ToolCall{Tool: "write_file", InputJSON: inputJSON, Output: "content is required", Success: false}, "write_file failed: content is required"
		}
		resp, err := e.ToolRunner.WriteFile(ctx, toolrunner.WriteFileRequest{
			RelativePath:  action.Path,
			Content:       action.Content,
			AllowedWrites: node.Outputs,
		})
		if err != nil {
			return domain.ToolCall{Tool: "write_file", InputJSON: inputJSON, Output: err.Error(), Success: false}, "write_file failed: " + err.Error()
		}
		return domain.ToolCall{Tool: "write_file", InputJSON: inputJSON, Output: resp.Output, Success: resp.Success}, "write_file result: " + firstNonEmpty(resp.Output, "ok")

	case "run_command":
		if strings.TrimSpace(action.Program) == "" {
			return domain.ToolCall{Tool: "run_command", InputJSON: inputJSON, Output: "program is required", Success: false}, "run_command failed: program is required"
		}
		timeout := action.TimeoutMs
		if timeout <= 0 {
			timeout = e.commandTimeoutMs()
		}
		resp, err := e.ToolRunner.RunCommand(ctx, toolrunner.RunCommandRequest{
			Program:   action.Program,
			Args:      append([]string{}, action.Args...),
			WorkDir:   action.WorkDir,
			TimeoutMs: timeout,
		})
		if err != nil {
			return domain.ToolCall{Tool: "run_command", InputJSON: inputJSON, Output: err.Error(), Success: false}, "run_command failed: " + err.Error()
		}
		observation := strings.TrimSpace(strings.Join(filterExecutorNonEmpty(resp.Stdout, resp.Stderr), "\n"))
		if observation == "" {
			observation = fmt.Sprintf("command exited with code %d", resp.ExitCode)
		}
		return domain.ToolCall{Tool: "run_command", InputJSON: inputJSON, Output: trimExecutorText(observation, 4000), Success: resp.Success}, fmt.Sprintf("run_command exit=%d\n%s", resp.ExitCode, trimExecutorText(observation, 4000))

	default:
		msg := fmt.Sprintf("unsupported action %q", action.Action)
		return domain.ToolCall{Tool: "unknown_action", InputJSON: inputJSON, Output: msg, Success: false}, msg
	}
}

func (e *LLMImplementExecutor) runAutoVerify(ctx context.Context, node *domain.Node, state *executorState) (*VerificationOutcome, string, error) {
	verifier := NewBasicVerifier(e.ToolRunner, nil, "", e.workspaceDir())
	outcome, err := verifier.VerifyNode(ctx, nil, node)
	if err != nil {
		return nil, "", err
	}
	state.Verifications = append(state.Verifications, cloneVerificationRecords(outcome.Records)...)
	return outcome, summarizeVerificationOutcome(outcome), nil
}

func (e *LLMImplementExecutor) canFinish(ctx context.Context, node *domain.Node) (bool, string) {
	for _, output := range node.Outputs {
		resp, err := e.ToolRunner.ReadFile(ctx, toolrunner.ReadFileRequest{RelativePath: output})
		if err != nil {
			return false, fmt.Sprintf("required output %s is not readable: %s", output, err.Error())
		}
		if resp == nil || !resp.Success || strings.TrimSpace(resp.Output) == "" {
			return false, fmt.Sprintf("required output %s is missing or empty", output)
		}
	}
	return true, ""
}

func (e *LLMImplementExecutor) collectOutputFiles(ctx context.Context, node *domain.Node) ([]domain.FileRecord, error) {
	files := make([]domain.FileRecord, 0, len(node.Outputs))
	for _, output := range dedupeOutputPaths(node.Outputs) {
		resp, err := e.ToolRunner.ReadFile(ctx, toolrunner.ReadFileRequest{RelativePath: output})
		if err != nil {
			return nil, err
		}
		content := []byte(resp.Output)
		files = append(files, domain.FileRecord{
			Path:      output,
			Operation: "create",
			SizeBytes: int64(len(content)),
			Checksum:  fmt.Sprintf("%x", sha256.Sum256(content))[:16],
			At:        time.Now().UTC(),
		})
	}
	return files, nil
}

func (e *LLMImplementExecutor) buildDependencyContext(ctx context.Context, g *domain.Graph, node *domain.Node) string {
	if len(node.DependsOn) == 0 {
		return "(none)"
	}
	parts := make([]string, 0, len(node.DependsOn))
	for _, depID := range node.DependsOn {
		dep := g.Nodes[depID]
		if dep == nil {
			continue
		}
		parts = append(parts, fmt.Sprintf("- %s (%s) outputs: %s", dep.ID, dep.Title, strings.Join(dep.Outputs, ", ")))
		for _, output := range dep.Outputs {
			resp, err := e.ToolRunner.ReadFile(ctx, toolrunner.ReadFileRequest{RelativePath: output})
			if err != nil || resp == nil || !resp.Success || strings.TrimSpace(resp.Output) == "" {
				continue
			}
			parts = append(parts, fmt.Sprintf("  file %s:\n%s", output, trimExecutorText(resp.Output, 1600)))
		}
	}
	if len(parts) == 0 {
		return "(none)"
	}
	return strings.Join(parts, "\n")
}

func (e *LLMImplementExecutor) buildCurrentOutputContext(ctx context.Context, node *domain.Node) string {
	parts := make([]string, 0, len(node.Outputs))
	for _, output := range node.Outputs {
		resp, err := e.ToolRunner.ReadFile(ctx, toolrunner.ReadFileRequest{RelativePath: output})
		if err != nil {
			parts = append(parts, fmt.Sprintf("- %s: not present (%s)", output, err.Error()))
			continue
		}
		if resp == nil || !resp.Success || strings.TrimSpace(resp.Output) == "" {
			parts = append(parts, fmt.Sprintf("- %s: empty", output))
			continue
		}
		parts = append(parts, fmt.Sprintf("- %s:\n%s", output, trimExecutorText(resp.Output, 2200)))
	}
	if len(parts) == 0 {
		return "(none)"
	}
	return strings.Join(parts, "\n")
}

func buildHistoryTranscript(entries []executorHistoryEntry) string {
	if len(entries) == 0 {
		return "(none yet)"
	}
	start := 0
	if len(entries) > 6 {
		start = len(entries) - 6
	}
	parts := make([]string, 0, len(entries)-start)
	for _, entry := range entries[start:] {
		parts = append(parts, fmt.Sprintf("Step %d assistant:\n%s\n\nObservation:\n%s", entry.Step, entry.AssistantRaw, entry.Observation))
	}
	return strings.Join(parts, "\n\n---\n\n")
}

func buildVerificationSummary(records []domain.VerificationRecord) string {
	if len(records) == 0 {
		return "(no automatic verification has run yet)"
	}
	start := 0
	if len(records) > 6 {
		start = len(records) - 6
	}
	parts := make([]string, 0, len(records)-start)
	for _, record := range records[start:] {
		status := "passed"
		if !record.Passed {
			status = "failed"
		}
		parts = append(parts, fmt.Sprintf("- %s %s: %s", record.Type, status, trimExecutorText(record.Output, 240)))
	}
	return strings.Join(parts, "\n")
}

func summarizeVerificationOutcome(outcome *VerificationOutcome) string {
	if outcome == nil {
		return "verification did not run"
	}
	parts := []string{buildVerificationSummary(outcome.Records)}
	if strings.TrimSpace(outcome.FailureSummary) != "" {
		parts = append(parts, "Failure summary: "+strings.TrimSpace(outcome.FailureSummary))
	}
	if outcome.Passed {
		parts = append(parts, "Overall result: passed")
	} else {
		parts = append(parts, "Overall result: failed")
	}
	return strings.Join(parts, "\n")
}

func cloneVerificationRecords(records []domain.VerificationRecord) []domain.VerificationRecord {
	out := make([]domain.VerificationRecord, len(records))
	copy(out, records)
	return out
}

func parseExecutorAction(text string) (*executorAction, error) {
	start := strings.Index(text, "{")
	end := strings.LastIndex(text, "}")
	if start < 0 || end <= start {
		return nil, fmt.Errorf("response did not contain a JSON object")
	}
	var action executorAction
	if err := json.Unmarshal([]byte(text[start:end+1]), &action); err != nil {
		return nil, err
	}
	if strings.TrimSpace(action.Action) == "" {
		return nil, fmt.Errorf("action field is required")
	}
	return &action, nil
}

func mustMarshalAction(action executorAction) string {
	raw, err := json.Marshal(action)
	if err != nil {
		return "{}"
	}
	return string(raw)
}

func dedupeOutputPaths(values []string) []string {
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

func trimExecutorText(s string, limit int) string {
	trimmed := strings.TrimSpace(stripCodeFences(s))
	if limit <= 0 || len(trimmed) <= limit {
		return trimmed
	}
	return trimmed[:limit] + "\n...(truncated)"
}

func (e *LLMImplementExecutor) workspaceDir() string {
	if strings.TrimSpace(e.Workspace) != "" {
		return e.Workspace
	}
	if local, ok := e.ToolRunner.(*toolrunner.LocalClient); ok && strings.TrimSpace(local.RootDir) != "" {
		return local.RootDir
	}
	return "."
}

func (e *LLMImplementExecutor) maxSteps() int {
	if e.MaxSteps > 0 {
		return e.MaxSteps
	}
	return 8
}

func (e *LLMImplementExecutor) commandTimeoutMs() int {
	if e.CommandTimeoutMs > 0 {
		return e.CommandTimeoutMs
	}
	return 30_000
}

func stripCodeFences(s string) string {
	if strings.HasPrefix(s, "```") {
		lines := strings.Split(s, "\n")
		if len(lines) >= 3 {
			lines = lines[1:]
			if lines[len(lines)-1] == "```" {
				lines = lines[:len(lines)-1]
			}
			return strings.Join(lines, "\n")
		}
	}
	return s
}

func filterExecutorNonEmpty(values ...string) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}
