package app

import (
	"context"

	"github.com/supermonkeyguys/specship/apps/server-go/internal/domain"
)

type ProjectService struct {
	Projects ProjectRepository
	Sessions SessionRepository
}

type ProjectListItem struct {
	ID        string               `json:"id"`
	Name      string               `json:"name"`
	RepoPath  string               `json:"repoPath,omitempty"`
	CreatedAt string               `json:"createdAt"`
	UpdatedAt string               `json:"updatedAt"`
	Sessions  []ProjectSessionItem `json:"sessions"`
}

type ProjectSessionItem struct {
	ID        string `json:"id"`
	Spec      string `json:"spec"`
	Status    string `json:"status"`
	Starred   bool   `json:"starred,omitempty"`
	CreatedAt string `json:"createdAt"`
}

func (s *ProjectService) List(ctx context.Context) ([]ProjectListItem, error) {
	projects, err := s.Projects.List(ctx)
	if err != nil {
		return nil, err
	}

	out := make([]ProjectListItem, 0, len(projects))
	for _, p := range projects {
		sessions, err := s.Sessions.ListByProject(ctx, p.ID)
		if err != nil {
			return nil, err
		}

		item := ProjectListItem{
			ID:        p.ID,
			Name:      p.Name,
			RepoPath:  p.RepoPath,
			CreatedAt: p.CreatedAt.Format(timeLayout),
			UpdatedAt: p.UpdatedAt.Format(timeLayout),
			Sessions:  make([]ProjectSessionItem, 0, len(sessions)),
		}

		for _, sess := range sessions {
			item.Sessions = append(item.Sessions, ProjectSessionItem{
				ID:        sess.ID,
				Spec:      sess.Spec,
				Status:    string(sess.Status),
				Starred:   sess.Starred,
				CreatedAt: sess.CreatedAt.Format(timeLayout),
			})
		}

		out = append(out, item)
	}

	return out, nil
}

const timeLayout = "2006-01-02T15:04:05.000Z07:00"

var _ = domain.Project{}

type ProjectMutationService struct {
	Projects ProjectRepository
	Sessions SessionRepository
	Runtime  RuntimeManager
}

func (s *ProjectMutationService) DeleteSession(ctx context.Context, projectID, sessionID string) error {
	sess, err := s.Sessions.Get(ctx, sessionID)
	if err != nil {
		return err
	}
	if sess.ProjectID != projectID {
		return domain.ErrNotFound
	}
	if s.Runtime != nil {
		_ = s.Runtime.Stop(ctx, sessionID)
	}
	return s.Sessions.Delete(ctx, sessionID)
}

func (s *ProjectMutationService) DeleteProject(ctx context.Context, projectID string) error {
	if _, err := s.Projects.Get(ctx, projectID); err != nil {
		return err
	}
	sessions, err := s.Sessions.ListByProject(ctx, projectID)
	if err != nil {
		return err
	}
	if s.Runtime != nil {
		for _, sess := range sessions {
			_ = s.Runtime.Stop(ctx, sess.ID)
		}
	}
	return s.Projects.Delete(ctx, projectID)
}

func (s *ProjectMutationService) UpdateSessionStarred(ctx context.Context, projectID, sessionID string, starred bool) error {
	sess, err := s.Sessions.Get(ctx, sessionID)
	if err != nil {
		return err
	}
	if sess.ProjectID != projectID {
		return domain.ErrNotFound
	}
	return s.Sessions.UpdateStarred(ctx, sessionID, starred)
}
