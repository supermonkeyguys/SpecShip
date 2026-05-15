package app

import (
	"context"
	"testing"
	"time"

	"github.com/supermonkeyguys/specship/apps/server-go/internal/domain"
	appruntime "github.com/supermonkeyguys/specship/apps/server-go/internal/runtime"
)

type restoreCall struct {
	input  appruntime.StartInput
	status domain.SessionStatus
	graph  *domain.Graph
}

type stubRecoverer struct{ calls []restoreCall }

func (s *stubRecoverer) Restore(_ context.Context, input appruntime.StartInput, status domain.SessionStatus, graph *domain.Graph) error {
	s.calls = append(s.calls, restoreCall{input: input, status: status, graph: graph})
	return nil
}

type graphMapRepo struct{ graphs map[string]*domain.Graph }

func (g *graphMapRepo) SaveSnapshot(_ context.Context, sessionID string, graph *domain.Graph) error {
	if g.graphs == nil {
		g.graphs = map[string]*domain.Graph{}
	}
	g.graphs[sessionID] = graph
	return nil
}
func (g *graphMapRepo) LoadSnapshot(_ context.Context, sessionID string) (*domain.Graph, error) {
	graph, ok := g.graphs[sessionID]
	if !ok {
		return nil, domain.ErrNotFound
	}
	return graph, nil
}

func TestRecoverActiveSessionsRestoresOnlyActiveSessionsWithSnapshots(t *testing.T) {
	now := time.Now().UTC()
	projects := NewInMemoryProjectRepository()
	sessions := NewInMemorySessionRepository()
	graphs := &graphMapRepo{graphs: map[string]*domain.Graph{
		"sess-running": {ID: "graph-running", Title: "Running", OriginalSpec: "run spec", Status: domain.GraphRunning, CreatedAt: now, UpdatedAt: now, Nodes: map[string]*domain.Node{}},
		"sess-paused":  {ID: "graph-paused", Title: "Paused", OriginalSpec: "pause spec", Status: domain.GraphPaused, CreatedAt: now, UpdatedAt: now, Nodes: map[string]*domain.Node{}},
	}}
	for _, p := range []*domain.Project{{ID: "proj-1", Name: "Project 1", RepoPath: "/tmp/repo-1", CreatedAt: now, UpdatedAt: now}} {
		if err := projects.Create(context.Background(), p); err != nil {
			t.Fatalf("create project: %v", err)
		}
	}
	for _, s := range []*domain.Session{
		{ID: "sess-running", ProjectID: "proj-1", Spec: "run spec", Status: domain.SessionRunning, CreatedAt: now, UpdatedAt: now},
		{ID: "sess-paused", ProjectID: "proj-1", Spec: "pause spec", Status: domain.SessionPaused, CreatedAt: now.Add(time.Second), UpdatedAt: now.Add(time.Second)},
		{ID: "sess-done", ProjectID: "proj-1", Spec: "done spec", Status: domain.SessionDone, CreatedAt: now.Add(2 * time.Second), UpdatedAt: now.Add(2 * time.Second)},
	} {
		if err := sessions.Create(context.Background(), s); err != nil {
			t.Fatalf("create session: %v", err)
		}
	}
	recoverer := &stubRecoverer{}
	if err := RecoverActiveSessions(context.Background(), recoverer, projects, sessions, graphs); err != nil {
		t.Fatalf("recover active sessions: %v", err)
	}
	if len(recoverer.calls) != 2 {
		t.Fatalf("expected 2 recovered sessions, got %d", len(recoverer.calls))
	}
	if recoverer.calls[0].input.RepoPath != "/tmp/repo-1" || recoverer.calls[1].input.RepoPath != "/tmp/repo-1" {
		t.Fatalf("expected repo path to be forwarded, got %+v", recoverer.calls)
	}
}
