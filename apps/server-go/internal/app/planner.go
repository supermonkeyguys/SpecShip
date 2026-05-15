package app

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/supermonkeyguys/specship/apps/server-go/internal/domain"
)

type StaticPlanner struct{}

func NewStaticPlanner() *StaticPlanner {
	return &StaticPlanner{}
}

func (p *StaticPlanner) BuildGraph(ctx context.Context, in domain.PlanInput) (*domain.Graph, error) {
	_ = ctx

	spec := strings.TrimSpace(in.Spec)
	if spec == "" {
		return nil, fmt.Errorf("spec is required")
	}

	title := strings.TrimSpace(in.Title)
	if title == "" {
		title = spec
		if len(title) > 60 {
			title = title[:60]
		}
	}

	now := in.Now
	if now.IsZero() {
		now = time.Now().UTC()
	}

	graph := &domain.Graph{
		ID:           in.GraphID,
		Title:        title,
		OriginalSpec: spec,
		Status:       domain.GraphRunning,
		Nodes:        map[string]*domain.Node{},
		CreatedAt:    now,
		UpdatedAt:    now,
	}

	implNode := &domain.Node{
		ID:                 "impl-1",
		Type:               domain.NodeImplement,
		Title:              title,
		Role:               "implementer",
		Task:               spec,
		AcceptanceCriteria: fmt.Sprintf("Generate a working static HTML prototype for: %s", spec),
		DependsOn:          []string{},
		Outputs:            []string{"output/index.html"},
		Status:             domain.NodeReady,
		RetryCount:         0,
		MaxRetries:         1,
		CreatedAt:          now,
		UpdatedAt:          now,
	}

	graph.Nodes[implNode.ID] = implNode
	return graph, nil
}
