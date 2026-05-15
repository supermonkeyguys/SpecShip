package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/supermonkeyguys/specship/apps/server-go/internal/app"
	"github.com/supermonkeyguys/specship/apps/server-go/internal/domain"
	"github.com/supermonkeyguys/specship/apps/server-go/internal/infra/toolrunner"
	appruntime "github.com/supermonkeyguys/specship/apps/server-go/internal/runtime"
)

type testPlanBuilder struct{}

func (testPlanBuilder) BuildGraph(_ context.Context, in domain.PlanInput) (*domain.Graph, error) {
	now := time.Now().UTC()
	return &domain.Graph{
		ID:           in.GraphID,
		Title:        "Test Plan",
		OriginalSpec: in.Spec,
		Status:       domain.GraphRunning,
		CreatedAt:    now,
		UpdatedAt:    now,
		Nodes: map[string]*domain.Node{
			"plan-1": {
				ID:                 "plan-1",
				Type:               domain.NodeCheckpoint,
				Title:              "Confirm plan",
				Role:               "checkpoint",
				Task:               "Review the generated plan",
				AcceptanceCriteria: "Approved by user",
				Outputs:            []string{},
			},
			"impl-1": {
				ID:                 "impl-1",
				Type:               domain.NodeImplement,
				Title:              "Implement feature",
				Role:               "implementer",
				Task:               "Build the requested feature",
				AcceptanceCriteria: "Code exists",
				DependsOn:          []string{"plan-1"},
				Outputs:            []string{"output/main.ts"},
			},
		},
	}, nil
}

func TestPlanHandlerReturnsMarkdownPlan(t *testing.T) {
	h := PlanHandler{Service: &app.PlanService{Planner: testPlanBuilder{}}}
	req := httptest.NewRequest(http.MethodPost, "/api/plan", strings.NewReader(`{"spec":"build a todo app"}`))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()

	h.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", res.Code, res.Body.String())
	}
	var body struct {
		OK   bool   `json:"ok"`
		Plan string `json:"plan"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !body.OK {
		t.Fatalf("expected ok=true, got false")
	}
	for _, part := range []string{"# Plan", "Test Plan", "Implement feature", "output/main.ts"} {
		if !strings.Contains(body.Plan, part) {
			t.Fatalf("expected plan to contain %q, got: %s", part, body.Plan)
		}
	}
}

func TestProjectFileMuxRoutesFilesAndReadContent(t *testing.T) {
	workspace := t.TempDir()
	filePath := filepath.Join(workspace, "sessions", "sess-1", "output", "main.ts")
	if err := os.MkdirAll(filepath.Dir(filePath), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(filePath, []byte("export const ok = true;\n"), 0o644); err != nil {
		t.Fatalf("write file: %v", err)
	}

	now := time.Now().UTC()
	sessions := app.NewInMemorySessionRepository()
	graphs := &stubGraphRepo{graph: &domain.Graph{
		ID:        "graph-1",
		Title:     "Graph",
		Status:    domain.GraphRunning,
		CreatedAt: now,
		UpdatedAt: now,
		Nodes: map[string]*domain.Node{
			"impl-1": {
				ID:      "impl-1",
				Type:    domain.NodeImplement,
				Title:   "Implement",
				Outputs: []string{"output/main.ts"},
			},
		},
	}}
	if err := sessions.Create(context.Background(), &domain.Session{
		ID:        "sess-1",
		ProjectID: "proj-1",
		Spec:      "spec",
		Status:    domain.SessionRunning,
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create session: %v", err)
	}

	projects := app.NewInMemoryProjectRepository()
	if err := projects.Create(context.Background(), &domain.Project{ID: "proj-1", Name: "Proj", CreatedAt: now, UpdatedAt: now}); err != nil {
		t.Fatalf("create project: %v", err)
	}

	mux := ProjectFileMuxHandler{
		GraphHandler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusTeapot)
		}),
		FileHandler: FileHandler{Service: &app.FileService{Projects: projects, Sessions: sessions, Graphs: graphs, WorkspaceDir: workspace}},
	}

	listReq := httptest.NewRequest(http.MethodGet, "/api/projects/proj-1/sessions/sess-1/files", nil)
	listRes := httptest.NewRecorder()
	mux.ServeHTTP(listRes, listReq)
	if listRes.Code != http.StatusOK {
		t.Fatalf("expected 200 for list, got %d: %s", listRes.Code, listRes.Body.String())
	}
	var listBody struct {
		Files []app.FileEntry `json:"files"`
	}
	if err := json.Unmarshal(listRes.Body.Bytes(), &listBody); err != nil {
		t.Fatalf("decode files response: %v", err)
	}
	if len(listBody.Files) != 1 || listBody.Files[0].Path != "output/main.ts" {
		t.Fatalf("unexpected files response: %+v", listBody.Files)
	}

	readReq := httptest.NewRequest(http.MethodGet, "/api/projects/proj-1/sessions/sess-1/file?path=output%2Fmain.ts", nil)
	readRes := httptest.NewRecorder()
	mux.ServeHTTP(readRes, readReq)
	if readRes.Code != http.StatusOK {
		t.Fatalf("expected 200 for read, got %d: %s", readRes.Code, readRes.Body.String())
	}
	var readBody struct {
		Content string `json:"content"`
	}
	if err := json.Unmarshal(readRes.Body.Bytes(), &readBody); err != nil {
		t.Fatalf("decode read response: %v", err)
	}
	if !strings.Contains(readBody.Content, "export const ok = true") {
		t.Fatalf("unexpected content: %q", readBody.Content)
	}
}

type stubGraphRepo struct {
	graph *domain.Graph
}

func (s *stubGraphRepo) SaveSnapshot(_ context.Context, _ string, _ *domain.Graph) error {
	return nil
}

func (s *stubGraphRepo) LoadSnapshot(_ context.Context, _ string) (*domain.Graph, error) {
	if s.graph == nil {
		return nil, domain.ErrNotFound
	}
	return s.graph, nil
}

func TestPreviewHandlerReturnsStaticPreviewStatusAndContent(t *testing.T) {
	workspace := t.TempDir()
	indexPath := filepath.Join(workspace, "sessions", "sess-preview", "output", "index.html")
	if err := os.MkdirAll(filepath.Dir(indexPath), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	html := `<!doctype html><html><head><title>Demo</title></head><body><script src="/assets/app.js"></script></body></html>`
	if err := os.WriteFile(indexPath, []byte(html), 0o644); err != nil {
		t.Fatalf("write preview html: %v", err)
	}

	now := time.Now().UTC()
	sessions := app.NewInMemorySessionRepository()
	graphs := &stubGraphRepo{graph: &domain.Graph{
		ID:        "graph-1",
		Title:     "Graph",
		Status:    domain.GraphRunning,
		CreatedAt: now,
		UpdatedAt: now,
		Nodes: map[string]*domain.Node{
			"impl-1": {
				ID:      "impl-1",
				Type:    domain.NodeImplement,
				Title:   "Implement",
				Outputs: []string{"output/index.html"},
			},
		},
	}}
	if err := sessions.Create(context.Background(), &domain.Session{
		ID:        "sess-preview",
		ProjectID: "proj-preview",
		Spec:      "spec",
		Status:    domain.SessionRunning,
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create session: %v", err)
	}

	projects := app.NewInMemoryProjectRepository()
	if err := projects.Create(context.Background(), &domain.Project{ID: "proj-preview", Name: "Proj Preview", CreatedAt: now, UpdatedAt: now}); err != nil {
		t.Fatalf("create project: %v", err)
	}

	preview := PreviewHandler{Service: &app.PreviewService{Projects: projects, Sessions: sessions, Graphs: graphs, WorkspaceDir: workspace}}

	statusReq := httptest.NewRequest(http.MethodGet, "/api/projects/proj-preview/sessions/sess-preview/preview", nil)
	statusRes := httptest.NewRecorder()
	preview.ServeHTTP(statusRes, statusReq)
	if statusRes.Code != http.StatusOK {
		t.Fatalf("expected 200 for preview status, got %d: %s", statusRes.Code, statusRes.Body.String())
	}
	var statusBody struct {
		OK              bool   `json:"ok"`
		Supported       bool   `json:"supported"`
		Kind            string `json:"kind"`
		EntryPath       string `json:"entryPath"`
		StaticSupported bool   `json:"staticSupported"`
		StaticURL       string `json:"staticUrl"`
		LiveSupported   bool   `json:"liveSupported"`
	}
	if err := json.Unmarshal(statusRes.Body.Bytes(), &statusBody); err != nil {
		t.Fatalf("decode preview status: %v", err)
	}
	if !statusBody.OK || !statusBody.Supported || statusBody.Kind != "static" || statusBody.EntryPath != "output/index.html" || !statusBody.StaticSupported || statusBody.StaticURL == "" || statusBody.LiveSupported {
		t.Fatalf("unexpected preview status: %+v", statusBody)
	}

	contentReq := httptest.NewRequest(http.MethodGet, "/api/projects/proj-preview/sessions/sess-preview/preview/content/output/index.html", nil)
	contentRes := httptest.NewRecorder()
	preview.ServeHTTP(contentRes, contentReq)
	if contentRes.Code != http.StatusOK {
		t.Fatalf("expected 200 for preview content, got %d: %s", contentRes.Code, contentRes.Body.String())
	}
	body := contentRes.Body.String()
	if !strings.Contains(body, `<base href="/api/projects/proj-preview/sessions/sess-preview/preview/content/output/">`) {
		t.Fatalf("expected injected base tag, got: %s", body)
	}
	if !strings.Contains(body, `src="/api/projects/proj-preview/sessions/sess-preview/preview/content/output/assets/app.js"`) {
		t.Fatalf("expected rewritten asset path, got: %s", body)
	}
}

func TestPreviewHandlerReturnsUnsupportedLiveStartGracefully(t *testing.T) {
	workspace := t.TempDir()
	now := time.Now().UTC()
	sessions := app.NewInMemorySessionRepository()
	graphs := &stubGraphRepo{graph: &domain.Graph{ID: "graph-1", Title: "Graph", Status: domain.GraphRunning, CreatedAt: now, UpdatedAt: now, Nodes: map[string]*domain.Node{}}}
	if err := sessions.Create(context.Background(), &domain.Session{
		ID:        "sess-no-preview",
		ProjectID: "proj-no-preview",
		Spec:      "spec",
		Status:    domain.SessionRunning,
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("create session: %v", err)
	}

	projects := app.NewInMemoryProjectRepository()
	if err := projects.Create(context.Background(), &domain.Project{ID: "proj-no-preview", Name: "Proj No Preview", CreatedAt: now, UpdatedAt: now}); err != nil {
		t.Fatalf("create project: %v", err)
	}

	preview := PreviewHandler{Service: &app.PreviewService{Projects: projects, Sessions: sessions, Graphs: graphs, WorkspaceDir: workspace}}
	startReq := httptest.NewRequest(http.MethodPost, "/api/projects/proj-no-preview/sessions/sess-no-preview/preview/live/start", nil)
	startRes := httptest.NewRecorder()
	preview.ServeHTTP(startRes, startReq)
	if startRes.Code != http.StatusOK {
		t.Fatalf("expected 200 for unsupported live start, got %d: %s", startRes.Code, startRes.Body.String())
	}
	var body struct {
		OK            bool   `json:"ok"`
		Supported     bool   `json:"supported"`
		Kind          string `json:"kind"`
		Reason        string `json:"reason"`
		LiveSupported bool   `json:"liveSupported"`
		LiveStatus    string `json:"liveStatus"`
	}
	if err := json.Unmarshal(startRes.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode live start response: %v", err)
	}
	if !body.OK || body.Supported || body.Kind != "none" || body.LiveSupported || body.LiveStatus != "idle" || !strings.Contains(body.Reason, "not yet supported") {
		t.Fatalf("unexpected live start response: %+v", body)
	}
}

type stubRuntimeManager struct {
	stopped []string
}

func (s *stubRuntimeManager) Start(_ context.Context, _ appruntime.StartInput) error { return nil }
func (s *stubRuntimeManager) Send(_ context.Context, _ string, _ appruntime.Command) error {
	return nil
}
func (s *stubRuntimeManager) Stop(_ context.Context, sessionID string) error {
	s.stopped = append(s.stopped, sessionID)
	return nil
}

func TestProjectMutationHandlerPatchStarAndDeleteSession(t *testing.T) {
	now := time.Now().UTC()
	projects := app.NewInMemoryProjectRepository()
	sessions := app.NewInMemorySessionRepository()
	if err := projects.Create(context.Background(), &domain.Project{ID: "proj-1", Name: "Proj", CreatedAt: now, UpdatedAt: now}); err != nil {
		t.Fatalf("create project: %v", err)
	}
	if err := sessions.Create(context.Background(), &domain.Session{ID: "sess-1", ProjectID: "proj-1", Spec: "spec", Status: domain.SessionRunning, CreatedAt: now, UpdatedAt: now}); err != nil {
		t.Fatalf("create session: %v", err)
	}
	runtime := &stubRuntimeManager{}
	h := ProjectMutationHandler{Service: &app.ProjectMutationService{Projects: projects, Sessions: sessions, Runtime: runtime}}

	patchReq := httptest.NewRequest(http.MethodPatch, "/api/projects/proj-1/sessions/sess-1", strings.NewReader(`{"starred":true}`))
	patchReq.Header.Set("Content-Type", "application/json")
	patchRes := httptest.NewRecorder()
	h.ServeHTTP(patchRes, patchReq)
	if patchRes.Code != http.StatusOK {
		t.Fatalf("expected 200 for patch, got %d: %s", patchRes.Code, patchRes.Body.String())
	}
	sess, err := sessions.Get(context.Background(), "sess-1")
	if err != nil {
		t.Fatalf("get session: %v", err)
	}
	if !sess.Starred {
		t.Fatalf("expected session to be starred")
	}

	deleteReq := httptest.NewRequest(http.MethodDelete, "/api/projects/proj-1/sessions/sess-1", nil)
	deleteRes := httptest.NewRecorder()
	h.ServeHTTP(deleteRes, deleteReq)
	if deleteRes.Code != http.StatusOK {
		t.Fatalf("expected 200 for delete session, got %d: %s", deleteRes.Code, deleteRes.Body.String())
	}
	if _, err := sessions.Get(context.Background(), "sess-1"); err == nil {
		t.Fatalf("expected session to be deleted")
	}
	if len(runtime.stopped) != 1 || runtime.stopped[0] != "sess-1" {
		t.Fatalf("expected runtime stop for sess-1, got %+v", runtime.stopped)
	}
}

func TestProjectMutationHandlerDeleteProject(t *testing.T) {
	now := time.Now().UTC()
	projects := app.NewInMemoryProjectRepository()
	sessions := app.NewInMemorySessionRepository()
	if err := projects.Create(context.Background(), &domain.Project{ID: "proj-2", Name: "Proj 2", CreatedAt: now, UpdatedAt: now}); err != nil {
		t.Fatalf("create project: %v", err)
	}
	for _, id := range []string{"sess-a", "sess-b"} {
		if err := sessions.Create(context.Background(), &domain.Session{ID: id, ProjectID: "proj-2", Spec: "spec", Status: domain.SessionRunning, CreatedAt: now, UpdatedAt: now}); err != nil {
			t.Fatalf("create session %s: %v", id, err)
		}
	}
	runtime := &stubRuntimeManager{}
	h := ProjectMutationHandler{Service: &app.ProjectMutationService{Projects: projects, Sessions: sessions, Runtime: runtime}}

	req := httptest.NewRequest(http.MethodDelete, "/api/projects/proj-2", nil)
	res := httptest.NewRecorder()
	h.ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("expected 200 for delete project, got %d: %s", res.Code, res.Body.String())
	}
	if _, err := projects.Get(context.Background(), "proj-2"); err == nil {
		t.Fatalf("expected project to be deleted")
	}
	if len(runtime.stopped) != 2 {
		t.Fatalf("expected two runtime stops, got %+v", runtime.stopped)
	}
}

func TestStaticPlannerBuildsImmediateSuccessfulImplementNodeShape(t *testing.T) {
	planner := app.NewStaticPlanner()
	graph, err := planner.BuildGraph(context.Background(), domain.PlanInput{GraphID: "g1", Spec: "build a landing page"})
	if err != nil {
		t.Fatalf("build graph: %v", err)
	}
	if len(graph.Nodes) != 1 {
		t.Fatalf("expected 1 node, got %d", len(graph.Nodes))
	}
	node := graph.Nodes["impl-1"]
	if node == nil {
		t.Fatalf("expected impl-1 node")
	}
	if node.Status != domain.NodeReady {
		t.Fatalf("expected impl-1 ready, got %s", node.Status)
	}
	if len(node.Outputs) != 1 || node.Outputs[0] != "output/index.html" {
		t.Fatalf("unexpected outputs: %+v", node.Outputs)
	}
}

func TestDeterministicExecutorWritesHTMLArtifact(t *testing.T) {
	workspace := t.TempDir()
	runner := toolrunner.NewLocalClient(workspace)
	executor := appruntime.NewDeterministicExecutor(runner)
	node := &domain.Node{
		ID:      "impl-1",
		Title:   "build a landing page",
		Task:    "build a landing page",
		Outputs: []string{"output/index.html"},
	}
	result, err := executor.ExecuteNode(context.Background(), &domain.Graph{ID: "sess-1"}, node)
	if err != nil {
		t.Fatalf("execute node: %v", err)
	}
	if result == nil || result.Evidence == nil || len(result.Evidence.FilesWritten) != 1 {
		t.Fatalf("unexpected evidence: %+v", result)
	}
	raw, err := os.ReadFile(filepath.Join(workspace, "output", "index.html"))
	if err != nil {
		t.Fatalf("read written file: %v", err)
	}
	if !strings.Contains(string(raw), "<!doctype html>") || !strings.Contains(string(raw), "build a landing page") {
		t.Fatalf("unexpected html output: %s", string(raw))
	}
}

func TestFileAndPreviewServicesPreferProjectRepoPathOverWorkspaceFallback(t *testing.T) {
	workspace := t.TempDir()
	repoRoot := t.TempDir()
	indexPath := filepath.Join(repoRoot, "output", "index.html")
	if err := os.MkdirAll(filepath.Dir(indexPath), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(indexPath, []byte("<!doctype html><html><body>repo-root</body></html>"), 0o644); err != nil {
		t.Fatalf("write repo file: %v", err)
	}
	now := time.Now().UTC()
	projects := app.NewInMemoryProjectRepository()
	sessions := app.NewInMemorySessionRepository()
	graphs := &stubGraphRepo{graph: &domain.Graph{ID: "sess-repo", Title: "Graph", Status: domain.GraphDone, CreatedAt: now, UpdatedAt: now, Nodes: map[string]*domain.Node{
		"impl-1": {ID: "impl-1", Type: domain.NodeImplement, Title: "Implement", Outputs: []string{"output/index.html"}},
	}}}
	if err := projects.Create(context.Background(), &domain.Project{ID: "proj-repo", Name: "Proj Repo", RepoPath: repoRoot, CreatedAt: now, UpdatedAt: now}); err != nil {
		t.Fatalf("create project: %v", err)
	}
	if err := sessions.Create(context.Background(), &domain.Session{ID: "sess-repo", ProjectID: "proj-repo", Spec: "spec", Status: domain.SessionDone, CreatedAt: now, UpdatedAt: now}); err != nil {
		t.Fatalf("create session: %v", err)
	}
	files := &app.FileService{Projects: projects, Sessions: sessions, Graphs: graphs, WorkspaceDir: workspace}
	list, err := files.ListSessionFiles(context.Background(), "proj-repo", "sess-repo")
	if err != nil {
		t.Fatalf("list files: %v", err)
	}
	if len(list.Files) != 1 || list.Files[0].Path != "output/index.html" {
		t.Fatalf("unexpected files: %+v", list.Files)
	}
	preview := &app.PreviewService{Projects: projects, Sessions: sessions, Graphs: graphs, WorkspaceDir: workspace}
	status, err := preview.GetStatus(context.Background(), "proj-repo", "sess-repo")
	if err != nil {
		t.Fatalf("preview status: %v", err)
	}
	if !status.Supported || status.EntryPath != "output/index.html" {
		t.Fatalf("unexpected preview status: %+v", status)
	}
}
