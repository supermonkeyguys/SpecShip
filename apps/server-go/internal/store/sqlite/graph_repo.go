package sqlite

import (
    "context"
    "database/sql"
    "encoding/json"
    "time"

    "github.com/supermonkeyguys/specship/apps/server-go/internal/domain"
)

type GraphRepository struct {
    db *sql.DB
}

func NewGraphRepository(db *DB) *GraphRepository {
    return &GraphRepository{db: db.SQL}
}

func (r *GraphRepository) SaveSnapshot(ctx context.Context, sessionID string, g *domain.Graph) error {
    payload, err := json.Marshal(g)
    if err != nil {
        return err
    }

    var completedAt any = nil
    if g.CompletedAt != nil {
        completedAt = g.CompletedAt.Format(time.RFC3339Nano)
    }

    _, err = r.db.ExecContext(ctx, `
        INSERT INTO graph_snapshots (session_id, graph_id, title, original_spec, status, payload, created_at, updated_at, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          graph_id = excluded.graph_id,
          title = excluded.title,
          original_spec = excluded.original_spec,
          status = excluded.status,
          payload = excluded.payload,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          completed_at = excluded.completed_at
    `,
        sessionID,
        g.ID,
        g.Title,
        g.OriginalSpec,
        string(g.Status),
        string(payload),
        g.CreatedAt.Format(time.RFC3339Nano),
        g.UpdatedAt.Format(time.RFC3339Nano),
        completedAt,
    )
    return err
}

func (r *GraphRepository) LoadSnapshot(ctx context.Context, sessionID string) (*domain.Graph, error) {
    row := r.db.QueryRowContext(ctx, `
        SELECT payload
        FROM graph_snapshots
        WHERE session_id = ?
    `, sessionID)

    var payload string
    if err := row.Scan(&payload); err != nil {
        if err == sql.ErrNoRows {
            return nil, domain.ErrNotFound
        }
        return nil, err
    }

    var g domain.Graph
    if err := json.Unmarshal([]byte(payload), &g); err != nil {
        return nil, err
    }
    if g.Nodes == nil {
        g.Nodes = map[string]*domain.Node{}
    }
    return &g, nil
}
