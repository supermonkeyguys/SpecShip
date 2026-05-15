package app

import (
	"context"
	"testing"
	"time"

	"github.com/supermonkeyguys/specship/apps/server-go/internal/domain"
	appruntime "github.com/supermonkeyguys/specship/apps/server-go/internal/runtime"
)

type sentCommand struct {
	sessionID string
	cmd       appruntime.Command
}

type captureRuntime struct{ sent []sentCommand }

func (c *captureRuntime) Start(context.Context, appruntime.StartInput) error { return nil }
func (c *captureRuntime) Stop(context.Context, string) error                 { return nil }
func (c *captureRuntime) Send(_ context.Context, sessionID string, cmd appruntime.Command) error {
	c.sent = append(c.sent, sentCommand{sessionID: sessionID, cmd: cmd})
	return nil
}

func TestRetrySessionSendsRetryNodeCommandsForFailedNodes(t *testing.T) {
	now := time.Now().UTC()
	projects := NewInMemoryProjectRepository()
	sessions := NewInMemorySessionRepository()
	graphs := &graphMapRepo{graphs: map[string]*domain.Graph{
		"sess-failed": {
			ID: "graph-1", Status: domain.GraphFailed, CreatedAt: now, UpdatedAt: now,
			Nodes: map[string]*domain.Node{
				"a": {ID: "a", Status: domain.NodeFailed},
				"b": {ID: "b", Status: domain.NodeBlocked},
			},
		},
	}}
	if err := projects.Create(context.Background(), &domain.Project{ID: "proj-1", Name: "Proj", CreatedAt: now, UpdatedAt: now}); err != nil {
		t.Fatalf("create project: %v", err)
	}
	if err := sessions.Create(context.Background(), &domain.Session{ID: "sess-failed", ProjectID: "proj-1", Spec: "spec", Status: domain.SessionFailed, CreatedAt: now, UpdatedAt: now}); err != nil {
		t.Fatalf("create session: %v", err)
	}
	rt := &captureRuntime{}
	svc := &NodeCompatService{Projects: projects, Sessions: sessions, Graphs: graphs, Runtime: rt}
	out, err := svc.RetrySession(context.Background(), "proj-1", "sess-failed")
	if err != nil {
		t.Fatalf("retry session: %v", err)
	}
	if !out.OK {
		t.Fatalf("expected ok response, got %+v", out)
	}
	if len(rt.sent) != 2 {
		t.Fatalf("expected 2 retry commands, got %d", len(rt.sent))
	}
}
