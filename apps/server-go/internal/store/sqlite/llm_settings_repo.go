package sqlite

import (
	"context"
	"database/sql"

	"github.com/supermonkeyguys/specship/apps/server-go/internal/app"
)

type LLMSettingsRepository struct {
	db *sql.DB
}

func NewLLMSettingsRepository(db *DB) *LLMSettingsRepository {
	return &LLMSettingsRepository{db: db.SQL}
}

func (r *LLMSettingsRepository) Load(ctx context.Context) (*app.LLMSettings, error) {
	row := r.db.QueryRowContext(ctx, `SELECT base_url, api_key FROM llm_settings WHERE id = 1`)
	var baseURL string
	var apiKey string
	if err := row.Scan(&baseURL, &apiKey); err != nil {
		if err == sql.ErrNoRows {
			return &app.LLMSettings{}, nil
		}
		return nil, err
	}
	return &app.LLMSettings{BaseURL: baseURL, APIKey: apiKey}, nil
}

func (r *LLMSettingsRepository) Save(ctx context.Context, settings app.LLMSettings) error {
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO llm_settings (id, base_url, api_key)
		VALUES (1, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			base_url = excluded.base_url,
			api_key = excluded.api_key
	`, settings.BaseURL, settings.APIKey)
	return err
}
