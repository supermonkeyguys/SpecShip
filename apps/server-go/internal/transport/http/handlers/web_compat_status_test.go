package handlers

import (
	"context"
	"testing"
	"time"

	"github.com/supermonkeyguys/specship/apps/server-go/internal/app"
	"github.com/supermonkeyguys/specship/apps/server-go/internal/domain"
)

func TestWebCompatServiceStatusPrefersLatestSessionEvenIfOlderFailedExists(t *testing.T) {
	projects := app.NewInMemoryProjectRepository()
	sessions := app.NewInMemorySessionRepository()
	graphs := &stubGraphRepo{graph: &domain.Graph{Nodes: map[string]*domain.Node{}}}
	now := time.Now().UTC()

	if err := projects.Create(context.Background(), &domain.Project{ID: "proj-1", Name: "Proj 1", CreatedAt: now.Add(-2 * time.Hour), UpdatedAt: now.Add(-2 * time.Hour)}); err != nil {
		t.Fatalf("create project 1: %v", err)
	}
	if err := projects.Create(context.Background(), &domain.Project{ID: "proj-2", Name: "Proj 2", CreatedAt: now.Add(-1 * time.Hour), UpdatedAt: now.Add(-1 * time.Hour)}); err != nil {
		t.Fatalf("create project 2: %v", err)
	}

	if err := sessions.Create(context.Background(), &domain.Session{ID: "sess-old-failed", ProjectID: "proj-1", Spec: "old failed", Status: domain.SessionFailed, CreatedAt: now.Add(-90 * time.Minute), UpdatedAt: now.Add(-90 * time.Minute)}); err != nil {
		t.Fatalf("create old session: %v", err)
	}
	if err := sessions.Create(context.Background(), &domain.Session{ID: "sess-new-done", ProjectID: "proj-2", Spec: "new done", Status: domain.SessionDone, CreatedAt: now.Add(-10 * time.Minute), UpdatedAt: now.Add(-5 * time.Minute)}); err != nil {
		t.Fatalf("create new session: %v", err)
	}

	svc := &app.WebCompatService{Projects: projects, Sessions: sessions, Graphs: graphs}
	status, err := svc.GetStatus(context.Background())
	if err != nil {
		t.Fatalf("get status: %v", err)
	}
	if status.ProjectID != "proj-2" || status.SessionID != "sess-new-done" {
		t.Fatalf("expected latest session to win, got %+v", status)
	}
	if status.CanResume {
		t.Fatalf("expected latest done session not resumable, got %+v", status)
	}
}
