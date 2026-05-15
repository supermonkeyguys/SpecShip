package llm

import (
	"strings"
	"time"
)

type Settings struct {
	BaseURL string `json:"baseURL,omitempty"`
	APIKey  string `json:"apiKey,omitempty"`
}

type ClientFactory struct {
	DefaultBaseURL string
	DefaultAPIKey  string
	Timeout        time.Duration
}

func (f ClientFactory) Resolve(settings *Settings) (baseURL string, apiKey string) {
	baseURL = strings.TrimSpace(f.DefaultBaseURL)
	apiKey = strings.TrimSpace(f.DefaultAPIKey)
	if settings == nil {
		return baseURL, apiKey
	}
	if value := strings.TrimSpace(settings.BaseURL); value != "" {
		baseURL = value
	}
	if value := strings.TrimSpace(settings.APIKey); value != "" {
		apiKey = value
	}
	return baseURL, apiKey
}

func (f ClientFactory) Client(settings *Settings) Client {
	baseURL, apiKey := f.Resolve(settings)
	if apiKey == "" {
		return nil
	}
	return NewOpenAICompatibleClient(Config{
		BaseURL: baseURL,
		APIKey:  apiKey,
		Timeout: f.Timeout,
	})
}
