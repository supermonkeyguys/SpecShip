package domain

import (
    "context"
    "time"
)

type PlanInput struct {
    GraphID string
    Spec    string
    Title   string
    Now     time.Time
}

type Planner interface {
    BuildGraph(ctx context.Context, in PlanInput) (*Graph, error)
}
