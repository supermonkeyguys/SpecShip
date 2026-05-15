package app

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/supermonkeyguys/specship/apps/server-go/internal/infra/llm"
)

type ClarifyService struct {
	Client        llm.Client
	Model         string
	Factory       llm.ClientFactory
	SettingsStore LLMSettingsStore
}

type ClarifyOption struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Description string `json:"description,omitempty"`
}

type ClarifyQuestion struct {
	ID      string          `json:"id"`
	Text    string          `json:"text"`
	Mode    string          `json:"mode"`
	Options []ClarifyOption `json:"options,omitempty"`
}

type ClarifyOutput struct {
	OK                 bool              `json:"ok"`
	NeedsClarification bool              `json:"needsClarification"`
	Questions          []ClarifyQuestion `json:"questions"`
	Confidence         string            `json:"confidence,omitempty"`
	Summary            string            `json:"summary,omitempty"`
}

const clarifyPrompt = `
You judge whether a product spec is too ambiguous to execute.

Return ONLY a JSON object:
{
  "needsClarification": true | false,
  "confidence": "low" | "medium" | "high",
  "summary": "short summary",
  "questions": [
    {"id":"q1","text":"...","mode":"free"},
    {"id":"q2","text":"...","mode":"options","options":[{"id":"a","label":"A","description":"..."}]}
  ]
}

Rules:
- Ask at most 3 questions.
- Only ask when missing information is truly blocking.
- Output JSON only.
`

func (s *ClarifyService) Clarify(ctx context.Context, spec string) (*ClarifyOutput, error) {
	return s.ClarifyWithSettings(ctx, spec, nil)
}

func (s *ClarifyService) ClarifyWithSettings(ctx context.Context, spec string, override *llm.Settings) (*ClarifyOutput, error) {
	spec = strings.TrimSpace(spec)
	if spec == "" {
		return &ClarifyOutput{OK: false, NeedsClarification: false, Questions: []ClarifyQuestion{}, Confidence: "low", Summary: ""}, nil
	}
	client := s.clientForRequest(ctx, override)
	if client == nil || strings.TrimSpace(s.Model) == "" {
		return &ClarifyOutput{OK: true, NeedsClarification: false, Questions: []ClarifyQuestion{}, Confidence: "medium", Summary: truncate(spec, 80)}, nil
	}

	out, err := client.Run(ctx, llm.RunInput{
		SystemPrompt: clarifyPrompt,
		UserPrompt:   "Spec: " + spec,
		Model:        s.Model,
		WithTools:    false,
	})
	if err != nil {
		return &ClarifyOutput{OK: true, NeedsClarification: false, Questions: []ClarifyQuestion{}, Confidence: "medium", Summary: truncate(spec, 80)}, nil
	}

	start := strings.Index(out.FinalText, "{")
	end := strings.LastIndex(out.FinalText, "}")
	if start < 0 || end <= start {
		return &ClarifyOutput{OK: true, NeedsClarification: false, Questions: []ClarifyQuestion{}, Confidence: "medium", Summary: truncate(spec, 80)}, nil
	}

	var parsed ClarifyOutput
	if err := json.Unmarshal([]byte(out.FinalText[start:end+1]), &parsed); err != nil {
		return &ClarifyOutput{OK: true, NeedsClarification: false, Questions: []ClarifyQuestion{}, Confidence: "medium", Summary: truncate(spec, 80)}, nil
	}
	parsed.OK = true
	if !parsed.NeedsClarification {
		parsed.Questions = []ClarifyQuestion{}
	}
	if parsed.Questions == nil {
		parsed.Questions = []ClarifyQuestion{}
	}
	if strings.TrimSpace(parsed.Confidence) == "" {
		parsed.Confidence = "medium"
	}
	return &parsed, nil
}

func truncate(s string, limit int) string {
	s = strings.TrimSpace(s)
	if limit <= 0 || len(s) <= limit {
		return s
	}
	return s[:limit]
}

var _ = fmt.Sprintf

func (s *ClarifyService) clientForRequest(ctx context.Context, override *llm.Settings) llm.Client {
	if override != nil {
		return s.Factory.Client(override)
	}
	if s.SettingsStore != nil {
		settings, err := s.SettingsStore.Load(ctx)
		if err == nil && settings != nil {
			if client := s.Factory.Client(settings); client != nil {
				return client
			}
		}
	}
	if s.Client != nil {
		return s.Client
	}
	return s.Factory.Client(nil)
}
