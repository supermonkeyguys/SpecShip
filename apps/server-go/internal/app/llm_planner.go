package app

import (
    "context"
    "encoding/json"
    "fmt"
    "path"
    "strings"
    "time"

    "github.com/supermonkeyguys/specship/apps/server-go/internal/domain"
    "github.com/supermonkeyguys/specship/apps/server-go/internal/infra/llm"
)

type LLMPlanner struct {
    Client llm.Client
    Model  string
    Fallback domain.Planner
}

type plannerPlan struct {
    Title       string        `json:"title"`
    Ambiguities []string      `json:"ambiguities"`
    Steps       []plannerStep `json:"steps"`
}

type plannerStep struct {
    ID                 string   `json:"id"`
    Title              string   `json:"title"`
    SpecFragment       string   `json:"specFragment"`
    NodeRole           string   `json:"nodeRole"`
    Task               string   `json:"task"`
    AcceptanceCriteria string   `json:"acceptanceCriteria"`
    Description        string   `json:"description"`
    OutputFile         string   `json:"outputFile"`
    DependsOn          []string `json:"dependsOn"`
    Role               string   `json:"role"`
}

func NewLLMPlanner(client llm.Client, model string, fallback domain.Planner) *LLMPlanner {
    return &LLMPlanner{Client: client, Model: model, Fallback: fallback}
}

func (p *LLMPlanner) BuildGraph(ctx context.Context, in domain.PlanInput) (*domain.Graph, error) {
    if p.Client == nil || strings.TrimSpace(p.Model) == "" {
        if p.Fallback != nil {
            return p.Fallback.BuildGraph(ctx, in)
        }
        return nil, fmt.Errorf("llm planner is not configured")
    }

    userPrompt := fmt.Sprintf("Output directory: output\n\nSpec: %s", in.Spec)
    out, err := p.Client.Run(ctx, llm.RunInput{
        SystemPrompt: GraphPlannerPrompt,
        UserPrompt:   userPrompt,
        Model:        p.Model,
        WithTools:    false,
    })
    if err != nil {
        if p.Fallback != nil {
            return p.Fallback.BuildGraph(ctx, in)
        }
        return nil, err
    }

    plan, err := parsePlannerPlan(out.FinalText)
    if err != nil {
        if p.Fallback != nil {
            return p.Fallback.BuildGraph(ctx, in)
        }
        return nil, err
    }

    return graphFromPlannerPlan(in, plan)
}

func parsePlannerPlan(text string) (*plannerPlan, error) {
    start := strings.Index(text, "{")
    end := strings.LastIndex(text, "}")
    if start < 0 || end <= start {
        return nil, fmt.Errorf("planner response did not contain JSON object")
    }
    raw := text[start : end+1]

    var plan plannerPlan
    if err := json.Unmarshal([]byte(raw), &plan); err != nil {
        return nil, err
    }
    if strings.TrimSpace(plan.Title) == "" {
        return nil, fmt.Errorf("planner title is empty")
    }
    if len(plan.Steps) == 0 {
        return nil, fmt.Errorf("planner returned no steps")
    }
    return &plan, nil
}

func graphFromPlannerPlan(in domain.PlanInput, plan *plannerPlan) (*domain.Graph, error) {
    now := in.Now
    if now.IsZero() {
        now = time.Now().UTC()
    }

    graph := &domain.Graph{
        ID:           in.GraphID,
        Title:        strings.TrimSpace(plan.Title),
        OriginalSpec: in.Spec,
        Status:       domain.GraphRunning,
        Nodes:        map[string]*domain.Node{},
        CreatedAt:    now,
        UpdatedAt:    now,
    }

    seen := map[string]struct{}{}
    for _, step := range plan.Steps {
        id := strings.TrimSpace(step.ID)
        if id == "" {
            return nil, fmt.Errorf("planner step id is empty")
        }
        if _, exists := seen[id]; exists {
            return nil, fmt.Errorf("duplicate planner step id: %s", id)
        }
        seen[id] = struct{}{}

        role := strings.TrimSpace(step.Role)
        nodeRole := strings.TrimSpace(step.NodeRole)
        if nodeRole == "" {
            nodeRole = role
        }
        nodeType := domain.NodeImplement
        if role == "checkpoint" {
            nodeType = domain.NodeCheckpoint
        }

        outputFile := normalizePlannerOutput(step.OutputFile)
        status := domain.NodePending
        if len(step.DependsOn) == 0 {
            status = domain.NodeReady
        }
        if nodeType == domain.NodeCheckpoint && len(step.DependsOn) == 0 {
            status = domain.NodeReady
        }

        graph.Nodes[id] = &domain.Node{
            ID:                 id,
            Type:               nodeType,
            Title:              strings.TrimSpace(step.Title),
            Role:               nodeRole,
            Task:               firstNonEmpty(step.Task, step.Description),
            AcceptanceCriteria: firstNonEmpty(step.AcceptanceCriteria, "Step-specific acceptance criteria not provided by planner."),
            DependsOn:          append([]string{}, step.DependsOn...),
            Outputs:            outputList(nodeType, outputFile),
            Status:             status,
            RetryCount:         0,
            MaxRetries:         maxRetriesFor(nodeType),
            CreatedAt:          now,
            UpdatedAt:          now,
        }
    }

    for _, node := range graph.Nodes {
        for _, dep := range node.DependsOn {
            if _, ok := graph.Nodes[dep]; !ok {
                return nil, fmt.Errorf("unknown dependency %s for node %s", dep, node.ID)
            }
        }
    }

    return graph, nil
}

func normalizePlannerOutput(outputFile string) string {
    cleaned := strings.TrimSpace(outputFile)
    if cleaned == "" {
        return "output/main.ts"
    }
    if strings.HasPrefix(cleaned, "output/") {
        return cleaned
    }
    if strings.HasPrefix(cleaned, "/") {
        return "output" + cleaned
    }
    return path.Join("output", cleaned)
}

func outputList(nodeType domain.NodeType, outputFile string) []string {
    if nodeType == domain.NodeCheckpoint {
        return nil
    }
    return []string{outputFile}
}

func maxRetriesFor(nodeType domain.NodeType) int {
    if nodeType == domain.NodeCheckpoint {
        return 0
    }
    return 3
}

func firstNonEmpty(values ...string) string {
    for _, v := range values {
        if strings.TrimSpace(v) != "" {
            return strings.TrimSpace(v)
        }
    }
    return ""
}
