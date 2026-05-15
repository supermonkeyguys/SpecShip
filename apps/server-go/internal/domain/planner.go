package domain

import (
	"context"
	"time"

	llminfra "github.com/supermonkeyguys/specship/apps/server-go/internal/infra/llm"
)

type PlanInput struct {
	GraphID     string
	Spec        string
	Title       string
	Now         time.Time
	LLMSettings *llminfra.Settings
}

type Planner interface {
	BuildGraph(ctx context.Context, in PlanInput) (*Graph, error)
}
