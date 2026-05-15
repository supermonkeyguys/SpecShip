package config

import "os"

type Config struct {
	HTTPAddr         string
	DBDriver         string
	DBDSN            string
	WorkspaceDir     string
	LLMBaseURL       string
	LLMAPIKey        string
	LLMPlannerModel  string
	LLMExecutorModel string
	LLMReviewerModel string
}

func Default() Config {
	return Config{
		HTTPAddr:         envOr("SHIPYARD_HTTP_ADDR", ":8080"),
		DBDriver:         "sqlite",
		DBDSN:            envOr("SHIPYARD_DB_DSN", "file:/private/tmp/shipyard-go.db?_pragma=foreign_keys(1)"),
		WorkspaceDir:     envOr("SHIPYARD_WORKSPACE_DIR", "/private/tmp/shipyard-go-workspace"),
		LLMBaseURL:       envOr("OPENAI_BASE_URL", "https://api.openai.com/v1"),
		LLMAPIKey:        os.Getenv("OPENAI_API_KEY"),
		LLMPlannerModel:  envOr("MODEL_PLANNER", "gpt-5.1"),
		LLMExecutorModel: envOr("MODEL_IMPLEMENTER", "gpt-5.1"),
		LLMReviewerModel: envOr("MODEL_REVIEWER", "gpt-5.1"),
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
