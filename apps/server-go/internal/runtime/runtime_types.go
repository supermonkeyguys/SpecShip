package runtime

import (
	"context"
	"time"

	"github.com/supermonkeyguys/specship/apps/server-go/internal/domain"
	llminfra "github.com/supermonkeyguys/specship/apps/server-go/internal/infra/llm"
)

type Command interface {
	commandName() string
}

type RetryNodeCommand struct {
	NodeID string
}

func (RetryNodeCommand) commandName() string { return "retry_node" }

type ResumeCommand struct{}

func (ResumeCommand) commandName() string { return "resume" }

type ApproveCheckpointCommand struct {
	NodeID string
}

func (ApproveCheckpointCommand) commandName() string { return "approve_checkpoint" }

type StartInput struct {
	ProjectID   string
	SessionID   string
	GraphID     string
	Title       string
	Spec        string
	RepoPath    string
	StrategyID  string
	LLMSettings *llminfra.Settings
}

type EventStore interface {
	Append(ctx context.Context, sessionID string, expectedRevision int64, events []EventRecord) error
	LatestRevision(ctx context.Context, sessionID string) (int64, error)
}

type SessionStore interface {
	UpdateStatus(ctx context.Context, sessionID string, status domain.SessionStatus) error
}

type GraphStore interface {
	SaveSnapshot(ctx context.Context, sessionID string, g *domain.Graph) error
}

type Executor interface {
	ExecuteNode(ctx context.Context, g *domain.Graph, node *domain.Node) (*ExecutionResult, error)
}

type ExecutionResult struct {
	Evidence *domain.Evidence
}

type EventRecord struct {
	ID        string
	Type      string
	Payload   []byte
	CreatedAt int64
}

type Planner = domain.Planner

type SchedulerClock interface {
	Now() time.Time
}
