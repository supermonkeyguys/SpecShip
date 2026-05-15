package app

import (
	"context"
	"strings"

	"github.com/supermonkeyguys/specship/apps/server-go/internal/infra/llm"
)

type PRDService struct {
	Client llm.Client
	Model  string
}

type PRDOutput struct {
	OK    bool   `json:"ok"`
	PRD   string `json:"prd,omitempty"`
	Error string `json:"error,omitempty"`
}

const prdPrompt = `
You are a product manager. Rewrite the user spec into a concise PRD in Markdown.

Structure:
- Title
- Goal
- Users
- Functional Requirements
- Non-Goals
- Acceptance Criteria

Return Markdown only.
`

func (s *PRDService) Generate(ctx context.Context, spec string) (*PRDOutput, error) {
	spec = strings.TrimSpace(spec)
	if spec == "" {
		return &PRDOutput{OK: false, Error: "spec is required"}, nil
	}
	if s.Client == nil || strings.TrimSpace(s.Model) == "" {
		return &PRDOutput{OK: true, PRD: fallbackPRD(spec)}, nil
	}

	out, err := s.Client.Run(ctx, llm.RunInput{
		SystemPrompt: prdPrompt,
		UserPrompt:   spec,
		Model:        s.Model,
		WithTools:    false,
	})
	if err != nil {
		return &PRDOutput{OK: false, Error: err.Error()}, nil
	}
	return &PRDOutput{OK: true, PRD: strings.TrimSpace(out.FinalText)}, nil
}

func fallbackPRD(spec string) string {
	return "# Product Requirements Document\n\n## Goal\n" + spec + "\n\n## Functional Requirements\n- Implement the requested capability.\n\n## Acceptance Criteria\n- The requested outcome is delivered and verifiable.\n"
}
