package sqlite

import (
	"context"
	"database/sql"
	"time"

	"github.com/supermonkeyguys/specship/apps/server-go/internal/domain"
)

type ProjectRepository struct {
	db *sql.DB
}

func NewProjectRepository(db *DB) *ProjectRepository {
	return &ProjectRepository{db: db.SQL}
}

func (r *ProjectRepository) List(ctx context.Context) ([]*domain.Project, error) {
	rows, err := r.db.QueryContext(ctx, `
        SELECT id, name, repo_path, created_at, updated_at
        FROM projects
        ORDER BY updated_at DESC
    `)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]*domain.Project, 0)
	for rows.Next() {
		p, err := scanProject(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (r *ProjectRepository) Create(ctx context.Context, p *domain.Project) error {
	_, err := r.db.ExecContext(ctx, `
        INSERT INTO projects (id, name, repo_path, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
    `,
		p.ID,
		p.Name,
		p.RepoPath,
		p.CreatedAt.Format(time.RFC3339Nano),
		p.UpdatedAt.Format(time.RFC3339Nano),
	)
	return err
}

func (r *ProjectRepository) Get(ctx context.Context, projectID string) (*domain.Project, error) {
	row := r.db.QueryRowContext(ctx, `
        SELECT id, name, repo_path, created_at, updated_at
        FROM projects
        WHERE id = ?
    `, projectID)
	p, err := scanProject(row)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	return p, nil
}

func (r *ProjectRepository) Touch(ctx context.Context, projectID string, at time.Time) error {
	res, err := r.db.ExecContext(ctx, `UPDATE projects SET updated_at = ? WHERE id = ?`, at.Format(time.RFC3339Nano), projectID)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err == nil && n == 0 {
		return domain.ErrNotFound
	}
	return err
}

func (r *ProjectRepository) Delete(ctx context.Context, projectID string) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM projects WHERE id = ?`, projectID)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err == nil && n == 0 {
		return domain.ErrNotFound
	}
	return err
}

type scanner interface {
	Scan(dest ...any) error
}

func scanProject(s scanner) (*domain.Project, error) {
	var p domain.Project
	var createdAt string
	var updatedAt string
	if err := s.Scan(&p.ID, &p.Name, &p.RepoPath, &createdAt, &updatedAt); err != nil {
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
	p.CreatedAt = ct
	p.UpdatedAt = ut
	return &p, nil
}
