package app

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/supermonkeyguys/specship/apps/server-go/internal/domain"
)

type PlanBuilder interface {
	BuildGraph(ctx context.Context, in domain.PlanInput) (*domain.Graph, error)
}

type PlanService struct {
	Planner PlanBuilder
}

type PlanOutput struct {
	OK    bool   `json:"ok"`
	Plan  string `json:"plan,omitempty"`
	Error string `json:"error,omitempty"`
}

func (s *PlanService) Generate(ctx context.Context, spec string) (*PlanOutput, error) {
	spec = strings.TrimSpace(spec)
	if spec == "" {
		return &PlanOutput{OK: false, Error: "spec is required"}, nil
	}
	if s == nil || s.Planner == nil {
		return &PlanOutput{OK: false, Error: "planner is not configured"}, nil
	}

	graph, err := s.Planner.BuildGraph(ctx, domain.PlanInput{
		GraphID: "plan-preview",
		Spec:    spec,
		Title:   previewTitle(spec),
	})
	if err != nil {
		return &PlanOutput{OK: false, Error: err.Error()}, nil
	}

	return &PlanOutput{OK: true, Plan: renderPlanMarkdown(graph)}, nil
}

func renderPlanMarkdown(graph *domain.Graph) string {
	if graph == nil {
		return "# Plan\n\n_No plan generated._\n"
	}

	ordered := orderedNodes(graph)
	lines := []string{
		"# Plan",
		"",
		fmt.Sprintf("## %s", firstNonEmptyPlan(graph.Title, "Execution Plan")),
		"",
	}
	if strings.TrimSpace(graph.OriginalSpec) != "" {
		lines = append(lines, "### Spec", "", graph.OriginalSpec, "")
	}
	lines = append(lines, "### Steps", "")
	for idx, node := range ordered {
		deps := "none"
		if len(node.DependsOn) > 0 {
			deps = strings.Join(node.DependsOn, ", ")
		}
		lines = append(lines,
			fmt.Sprintf("%d. **%s** (`%s` / %s)", idx+1, firstNonEmptyPlan(node.Title, node.ID), node.ID, node.Type),
			fmt.Sprintf("   - Role: %s", firstNonEmptyPlan(node.Role, "unspecified")),
			fmt.Sprintf("   - Depends on: %s", deps),
		)
		if strings.TrimSpace(node.Task) != "" {
			lines = append(lines, fmt.Sprintf("   - Task: %s", strings.TrimSpace(node.Task)))
		}
		if strings.TrimSpace(node.AcceptanceCriteria) != "" {
			lines = append(lines, fmt.Sprintf("   - Acceptance: %s", strings.TrimSpace(node.AcceptanceCriteria)))
		}
		if len(node.Outputs) > 0 {
			lines = append(lines, fmt.Sprintf("   - Outputs: %s", strings.Join(node.Outputs, ", ")))
		}
		lines = append(lines, "")
	}
	return strings.Join(lines, "\n")
}

func orderedNodes(graph *domain.Graph) []*domain.Node {
	if graph == nil || len(graph.Nodes) == 0 {
		return nil
	}
	items := make([]*domain.Node, 0, len(graph.Nodes))
	for _, node := range graph.Nodes {
		items = append(items, node)
	}
	sort.Slice(items, func(i, j int) bool {
		left := dependencyRank(items[i])
		right := dependencyRank(items[j])
		if left != right {
			return left < right
		}
		return items[i].ID < items[j].ID
	})
	return items
}

func dependencyRank(node *domain.Node) int {
	if node == nil {
		return 0
	}
	return len(node.DependsOn)
}

func previewTitle(spec string) string {
	spec = strings.TrimSpace(spec)
	if len(spec) <= 48 {
		return spec
	}
	return strings.TrimSpace(spec[:48])
}

func firstNonEmptyPlan(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
