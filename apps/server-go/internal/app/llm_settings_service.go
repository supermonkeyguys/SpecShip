package app

import (
	"context"
	"strings"

	llminfra "github.com/supermonkeyguys/specship/apps/server-go/internal/infra/llm"
)

type LLMSettings = llminfra.Settings

type LLMSettingsOutput struct {
	OK        bool   `json:"ok"`
	BaseURL   string `json:"baseURL"`
	APIKey    string `json:"apiKey"`
	HasAPIKey bool   `json:"hasApiKey"`
	Error     string `json:"error,omitempty"`
}

type LLMSettingsService struct {
	Store LLMSettingsStore
}

func (s *LLMSettingsService) Get(ctx context.Context) (*LLMSettingsOutput, error) {
	if s == nil || s.Store == nil {
		return &LLMSettingsOutput{OK: true, BaseURL: "", APIKey: "", HasAPIKey: false}, nil
	}
	settings, err := s.Store.Load(ctx)
	if err != nil {
		return nil, err
	}
	if settings == nil {
		return &LLMSettingsOutput{OK: true, BaseURL: "", APIKey: "", HasAPIKey: false}, nil
	}
	return &LLMSettingsOutput{
		OK:        true,
		BaseURL:   strings.TrimSpace(settings.BaseURL),
		APIKey:    strings.TrimSpace(settings.APIKey),
		HasAPIKey: strings.TrimSpace(settings.APIKey) != "",
	}, nil
}

func (s *LLMSettingsService) Save(ctx context.Context, settings LLMSettings) (*LLMSettingsOutput, error) {
	settings.BaseURL = strings.TrimSpace(settings.BaseURL)
	settings.APIKey = strings.TrimSpace(settings.APIKey)
	if s == nil || s.Store == nil {
		return &LLMSettingsOutput{OK: true, BaseURL: settings.BaseURL, APIKey: settings.APIKey, HasAPIKey: settings.APIKey != ""}, nil
	}
	if err := s.Store.Save(ctx, settings); err != nil {
		return nil, err
	}
	return &LLMSettingsOutput{OK: true, BaseURL: settings.BaseURL, APIKey: settings.APIKey, HasAPIKey: settings.APIKey != ""}, nil
}
