package app

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/supermonkeyguys/specship/apps/server-go/internal/domain"
)

type PreviewService struct {
	Projects     ProjectRepository
	Sessions     SessionRepository
	Graphs       GraphRepository
	WorkspaceDir string
}

type PreviewStatusOutput struct {
	OK              bool   `json:"ok"`
	Supported       bool   `json:"supported"`
	Kind            string `json:"kind"`
	URL             string `json:"url,omitempty"`
	EntryPath       string `json:"entryPath,omitempty"`
	Reason          string `json:"reason,omitempty"`
	StaticSupported bool   `json:"staticSupported,omitempty"`
	StaticURL       string `json:"staticUrl,omitempty"`
	LiveSupported   bool   `json:"liveSupported,omitempty"`
	LiveStatus      string `json:"liveStatus,omitempty"`
	LiveURL         string `json:"liveUrl,omitempty"`
	LivePort        int    `json:"livePort,omitempty"`
	LiveCommand     string `json:"liveCommand,omitempty"`
	LiveError       string `json:"liveError,omitempty"`
}

func (s *PreviewService) GetStatus(ctx context.Context, projectID, sessionID string) (*PreviewStatusOutput, error) {
	sess, graph, err := s.loadSessionGraph(ctx, projectID, sessionID)
	if err != nil {
		return nil, err
	}

	root := ResolveSessionExecutionRoot(ctx, s.Projects, sess, s.WorkspaceDir)
	entryPath, ok := s.resolveStaticEntry(root, graph)
	if !ok {
		return &PreviewStatusOutput{
			OK:              true,
			Supported:       false,
			Kind:            "none",
			Reason:          "No static preview entry found, and live preview is not yet supported by server-go.",
			StaticSupported: false,
			LiveSupported:   false,
			LiveStatus:      "idle",
		}, nil
	}

	url := buildStaticPreviewURL(projectID, sessionID, entryPath)
	return &PreviewStatusOutput{
		OK:              true,
		Supported:       true,
		Kind:            "static",
		URL:             url,
		EntryPath:       entryPath,
		Reason:          "Static preview is available. Live preview is not yet supported by server-go.",
		StaticSupported: true,
		StaticURL:       url,
		LiveSupported:   false,
		LiveStatus:      "idle",
	}, nil
}

func (s *PreviewService) StartLivePreview(ctx context.Context, projectID, sessionID string) (*PreviewStatusOutput, error) {
	status, err := s.GetStatus(ctx, projectID, sessionID)
	if err != nil {
		return nil, err
	}
	status.LiveSupported = false
	status.LiveStatus = "idle"
	if status.StaticSupported {
		status.Reason = "Static preview is available. Live preview is not yet supported by server-go."
	} else {
		status.Reason = "Live preview is not yet supported by server-go."
	}
	return status, nil
}

func (s *PreviewService) StopLivePreview(ctx context.Context, projectID, sessionID string) (*PreviewStatusOutput, error) {
	status, err := s.StartLivePreview(ctx, projectID, sessionID)
	if err != nil {
		return nil, err
	}
	return status, nil
}

func (s *PreviewService) ReadPreviewContent(ctx context.Context, projectID, sessionID, relPath string) ([]byte, bool, error) {
	sess, graph, err := s.loadSessionGraph(ctx, projectID, sessionID)
	if err != nil {
		return nil, false, err
	}
	root := ResolveSessionExecutionRoot(ctx, s.Projects, sess, s.WorkspaceDir)
	entryPath, ok := s.resolveStaticEntry(root, graph)
	if !ok {
		return nil, false, domain.ErrNotFound
	}

	cleaned, ok := sanitizeRelativePath(relPath)
	if !ok {
		return nil, false, fmt.Errorf("invalid preview path")
	}
	full := filepath.Join(root, filepath.FromSlash(cleaned))
	if !isWithinRoot(root, full) {
		return nil, false, fmt.Errorf("invalid preview path")
	}
	info, err := os.Stat(full)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, false, domain.ErrNotFound
		}
		return nil, false, err
	}
	if info.IsDir() {
		return nil, false, domain.ErrNotFound
	}
	data, err := os.ReadFile(full)
	if err != nil {
		return nil, false, err
	}
	isHTML := strings.EqualFold(filepath.Ext(cleaned), ".html")
	if isHTML {
		return []byte(rewriteHTMLForPreview(string(data), projectID, sessionID, cleaned, entryPath)), true, nil
	}
	return data, false, nil
}

func (s *PreviewService) resolveStaticEntry(root string, graph *domain.Graph) (string, bool) {
	candidateSet := map[string]struct{}{}
	for _, candidate := range collectGraphFileCandidates(graph) {
		cleaned, ok := sanitizeRelativePath(candidate)
		if !ok {
			continue
		}
		if strings.EqualFold(filepath.Base(cleaned), "index.html") {
			candidateSet[cleaned] = struct{}{}
		}
		if strings.HasSuffix(cleaned, ".html") {
			candidateSet[cleaned] = struct{}{}
		}
	}
	for _, fallback := range []string{"index.html", "dist/index.html", "public/index.html", "build/index.html", "output/index.html", "output/dist/index.html", "output/public/index.html", "output/build/index.html"} {
		candidateSet[fallback] = struct{}{}
	}

	candidates := make([]string, 0, len(candidateSet))
	for candidate := range candidateSet {
		candidates = append(candidates, candidate)
	}
	sort.Slice(candidates, func(i, j int) bool {
		return previewRank(candidates[i]) < previewRank(candidates[j]) || (previewRank(candidates[i]) == previewRank(candidates[j]) && candidates[i] < candidates[j])
	})

	for _, rel := range candidates {
		full := filepath.Join(root, filepath.FromSlash(rel))
		if info, err := os.Stat(full); err == nil && !info.IsDir() {
			return filepath.ToSlash(rel), true
		}
	}
	return "", false
}

func previewRank(rel string) int {
	switch filepath.ToSlash(rel) {
	case "index.html":
		return 0
	case "dist/index.html":
		return 1
	case "public/index.html":
		return 2
	case "build/index.html":
		return 3
	case "output/index.html":
		return 4
	case "output/dist/index.html":
		return 5
	case "output/public/index.html":
		return 6
	case "output/build/index.html":
		return 7
	default:
		if strings.HasSuffix(filepath.ToSlash(rel), "/index.html") {
			return 20
		}
		return 50
	}
}

func rewriteHTMLForPreview(html, projectID, sessionID, currentPath, entryPath string) string {
	_ = entryPath
	dir := filepath.ToSlash(filepath.Dir(currentPath))
	basePrefix := fmt.Sprintf("/api/projects/%s/sessions/%s/preview/content/", projectID, sessionID)
	if dir != "." && dir != "" {
		basePrefix += dir + "/"
	}

	next := rewriteAbsoluteAssetRefs(html, basePrefix)
	if !strings.Contains(strings.ToLower(next), "<base ") {
		next = injectBaseTag(next, basePrefix)
	}
	return next
}

func injectBaseTag(html, basePrefix string) string {
	lower := strings.ToLower(html)
	idx := strings.Index(lower, "<head")
	if idx < 0 {
		return html
	}
	end := strings.Index(lower[idx:], ">")
	if end < 0 {
		return html
	}
	insertAt := idx + end + 1
	return html[:insertAt] + `<base href="` + basePrefix + `">` + html[insertAt:]
}

func rewriteAbsoluteAssetRefs(html, basePrefix string) string {
	replacer := strings.NewReplacer(
		`href="/`, `href="`+basePrefix,
		`href='/`, `href='`+basePrefix,
		`src="/`, `src="`+basePrefix,
		`src='/`, `src='`+basePrefix,
		`action="/`, `action="`+basePrefix,
		`action='/`, `action='`+basePrefix,
		`poster="/`, `poster="`+basePrefix,
		`poster='/`, `poster='`+basePrefix,
		`url(/`, `url(`+basePrefix,
		`url('/`, `url('`+basePrefix,
		`url("/`, `url("`+basePrefix,
	)
	return replacer.Replace(html)
}

func buildStaticPreviewURL(projectID, sessionID, relPath string) string {
	return fmt.Sprintf("/api/projects/%s/sessions/%s/preview/content/%s", projectID, sessionID, relPath)
}

func (s *PreviewService) loadSessionGraph(ctx context.Context, projectID, sessionID string) (*domain.Session, *domain.Graph, error) {
	sess, err := s.Sessions.Get(ctx, sessionID)
	if err != nil {
		return nil, nil, err
	}
	if strings.TrimSpace(projectID) != "" && sess.ProjectID != projectID {
		return nil, nil, fmt.Errorf("session does not belong to project")
	}
	graph, err := s.Graphs.LoadSnapshot(ctx, sessionID)
	if err != nil {
		if err == domain.ErrNotFound {
			return sess, &domain.Graph{Nodes: map[string]*domain.Node{}}, nil
		}
		return nil, nil, err
	}
	if graph.Nodes == nil {
		graph.Nodes = map[string]*domain.Node{}
	}
	return sess, graph, nil
}

func (s *PreviewService) workspaceDir() string {
	root := strings.TrimSpace(s.WorkspaceDir)
	if root == "" {
		root = "./workspace"
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		return root
	}
	return abs
}

func isWithinRoot(root, full string) bool {
	rel, err := filepath.Rel(root, full)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}
