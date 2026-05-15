package sqlite

import (
	"context"
	"database/sql"
	"time"

	"github.com/supermonkeyguys/specship/apps/server-go/internal/domain"
)

type SessionRepository struct {
	db *sql.DB
}

func NewSessionRepository(db *DB) *SessionRepository {
	return &SessionRepository{db: db.SQL}
}

func (r *SessionRepository) Create(ctx context.Context, s *domain.Session) error {
	_, err := r.db.ExecContext(ctx, `
        INSERT INTO sessions (id, project_id, spec, status, starred, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
		s.ID,
		s.ProjectID,
		s.Spec,
		string(s.Status),
		boolToInt(s.Starred),
		s.CreatedAt.Format(time.RFC3339Nano),
		s.UpdatedAt.Format(time.RFC3339Nano),
	)
	return err
}

func (r *SessionRepository) Get(ctx context.Context, sessionID string) (*domain.Session, error) {
	row := r.db.QueryRowContext(ctx, `
        SELECT id, project_id, spec, status, starred, created_at, updated_at
        FROM sessions
        WHERE id = ?
    `, sessionID)
	sess, err := scanSession(row)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	return sess, nil
}

func (r *SessionRepository) UpdateStatus(ctx context.Context, sessionID string, status domain.SessionStatus) error {
	res, err := r.db.ExecContext(ctx, `
        UPDATE sessions
        SET status = ?, updated_at = ?
        WHERE id = ?
    `, string(status), time.Now().UTC().Format(time.RFC3339Nano), sessionID)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err == nil && n == 0 {
		return domain.ErrNotFound
	}
	return err
}

func (r *SessionRepository) UpdateStarred(ctx context.Context, sessionID string, starred bool) error {
	res, err := r.db.ExecContext(ctx, `
        UPDATE sessions
        SET starred = ?, updated_at = ?
        WHERE id = ?
    `, boolToInt(starred), time.Now().UTC().Format(time.RFC3339Nano), sessionID)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err == nil && n == 0 {
		return domain.ErrNotFound
	}
	return err
}

func (r *SessionRepository) Delete(ctx context.Context, sessionID string) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM sessions WHERE id = ?`, sessionID)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err == nil && n == 0 {
		return domain.ErrNotFound
	}
	return err
}

func (r *SessionRepository) ListByProject(ctx context.Context, projectID string) ([]*domain.Session, error) {
	rows, err := r.db.QueryContext(ctx, `
        SELECT id, project_id, spec, status, starred, created_at, updated_at
        FROM sessions
        WHERE project_id = ?
        ORDER BY created_at DESC
    `, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]*domain.Session, 0)
	for rows.Next() {
		sess, err := scanSession(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, sess)
	}
	return out, rows.Err()
}

func scanSession(s scanner) (*domain.Session, error) {
	var sess domain.Session
	var status string
	var starred int
	var createdAt string
	var updatedAt string
	if err := s.Scan(&sess.ID, &sess.ProjectID, &sess.Spec, &status, &starred, &createdAt, &updatedAt); err != nil {
		return nil, err
	}
	ct, err := time.Parse(time.RFC3339Nano, createdAt)
	if err != nil {
		return nil, err
	}
	ut, err := time.Parse(time.RFC3339Nano, updatedAt)
	if err != nil {
		return nil, err
	}
	sess.Status = domain.SessionStatus(status)
	sess.Starred = starred != 0
	sess.CreatedAt = ct
	sess.UpdatedAt = ut
	return &sess, nil
}

func boolToInt(v bool) int {
	if v {
		return 1
	}
	return 0
}
