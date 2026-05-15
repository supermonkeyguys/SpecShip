package app

import (
	"context"
	"time"

	"github.com/supermonkeyguys/specship/apps/server-go/internal/domain"
	appruntime "github.com/supermonkeyguys/specship/apps/server-go/internal/runtime"
)

type ProjectRepository interface {
	List(ctx context.Context) ([]*domain.Project, error)
	Create(ctx context.Context, p *domain.Project) error
	Get(ctx context.Context, projectID string) (*domain.Project, error)
	Touch(ctx context.Context, projectID string, at time.Time) error
	Delete(ctx context.Context, projectID string) error
}

type SessionRepository interface {
	Create(ctx context.Context, s *domain.Session) error
	Get(ctx context.Context, sessionID string) (*domain.Session, error)
	UpdateStatus(ctx context.Context, sessionID string, status domain.SessionStatus) error
	UpdateStarred(ctx context.Context, sessionID string, starred bool) error
	Delete(ctx context.Context, sessionID string) error
	ListByProject(ctx context.Context, projectID string) ([]*domain.Session, error)
}

type GraphRepository interface {
	SaveSnapshot(ctx context.Context, sessionID string, g *domain.Graph) error
	LoadSnapshot(ctx context.Context, sessionID string) (*domain.Graph, error)
}

type EventStore interface {
	List(ctx context.Context, sessionID string, afterRevision int64) ([]domain.Event, error)
	LatestRevision(ctx context.Context, sessionID string) (int64, error)
}

type RuntimeManager interface {
	Start(ctx context.Context, input appruntime.StartInput) error
	Send(ctx context.Context, sessionID string, cmd appruntime.Command) error
	Stop(ctx context.Context, sessionID string) error
}
