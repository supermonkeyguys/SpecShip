package app

import (
	"context"
	"sort"
	"sync"
	"time"

	"github.com/supermonkeyguys/specship/apps/server-go/internal/domain"
)

type InMemoryProjectRepository struct {
	mu       sync.RWMutex
	projects map[string]*domain.Project
}

func NewInMemoryProjectRepository() *InMemoryProjectRepository {
	return &InMemoryProjectRepository{projects: map[string]*domain.Project{}}
}

func (r *InMemoryProjectRepository) List(ctx context.Context) ([]*domain.Project, error) {
	_ = ctx
	r.mu.RLock()
	defer r.mu.RUnlock()

	out := make([]*domain.Project, 0, len(r.projects))
	for _, p := range r.projects {
		cp := *p
		out = append(out, &cp)
	}

	sort.Slice(out, func(i, j int) bool {
		return out[i].UpdatedAt.After(out[j].UpdatedAt)
	})
	return out, nil
}

func (r *InMemoryProjectRepository) Create(ctx context.Context, p *domain.Project) error {
	_ = ctx
	r.mu.Lock()
	defer r.mu.Unlock()
	r.projects[p.ID] = cloneProject(p)
	return nil
}

func (r *InMemoryProjectRepository) Get(ctx context.Context, projectID string) (*domain.Project, error) {
	_ = ctx
	r.mu.RLock()
	defer r.mu.RUnlock()
	p, ok := r.projects[projectID]
	if !ok {
		return nil, domain.ErrNotFound
	}
	cp := *p
	return &cp, nil
}

func (r *InMemoryProjectRepository) Touch(ctx context.Context, projectID string, at time.Time) error {
	_ = ctx
	r.mu.Lock()
	defer r.mu.Unlock()
	p, ok := r.projects[projectID]
	if !ok {
		return domain.ErrNotFound
	}
	p.UpdatedAt = at
	return nil
}

func (r *InMemoryProjectRepository) Delete(ctx context.Context, projectID string) error {
	_ = ctx
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.projects[projectID]; !ok {
		return domain.ErrNotFound
	}
	delete(r.projects, projectID)
	return nil
}

type InMemorySessionRepository struct {
	mu       sync.RWMutex
	sessions map[string]*domain.Session
}

func NewInMemorySessionRepository() *InMemorySessionRepository {
	return &InMemorySessionRepository{sessions: map[string]*domain.Session{}}
}

func (r *InMemorySessionRepository) Create(ctx context.Context, s *domain.Session) error {
	_ = ctx
	r.mu.Lock()
	defer r.mu.Unlock()
	r.sessions[s.ID] = cloneSession(s)
	return nil
}

func (r *InMemorySessionRepository) Get(ctx context.Context, sessionID string) (*domain.Session, error) {
	_ = ctx
	r.mu.RLock()
	defer r.mu.RUnlock()
	s, ok := r.sessions[sessionID]
	if !ok {
		return nil, domain.ErrNotFound
	}
	cp := *s
	return &cp, nil
}

func (r *InMemorySessionRepository) UpdateStatus(ctx context.Context, sessionID string, status domain.SessionStatus) error {
	_ = ctx
	r.mu.Lock()
	defer r.mu.Unlock()
	s, ok := r.sessions[sessionID]
	if !ok {
		return domain.ErrNotFound
	}
	s.Status = status
	s.UpdatedAt = time.Now().UTC()
	return nil
}

func (r *InMemorySessionRepository) UpdateStarred(ctx context.Context, sessionID string, starred bool) error {
	_ = ctx
	r.mu.Lock()
	defer r.mu.Unlock()
	s, ok := r.sessions[sessionID]
	if !ok {
		return domain.ErrNotFound
	}
	s.Starred = starred
	s.UpdatedAt = time.Now().UTC()
	return nil
}

func (r *InMemorySessionRepository) Delete(ctx context.Context, sessionID string) error {
	_ = ctx
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.sessions[sessionID]; !ok {
		return domain.ErrNotFound
	}
	delete(r.sessions, sessionID)
	return nil
}

func (r *InMemorySessionRepository) ListByProject(ctx context.Context, projectID string) ([]*domain.Session, error) {
	_ = ctx
	r.mu.RLock()
	defer r.mu.RUnlock()

	out := make([]*domain.Session, 0)
	for _, s := range r.sessions {
		if s.ProjectID != projectID {
			continue
		}
		cp := *s
		out = append(out, &cp)
	}

	sort.Slice(out, func(i, j int) bool {
		return out[i].CreatedAt.After(out[j].CreatedAt)
	})
	return out, nil
}

type InMemoryGraphRepository struct{}

func NewInMemoryGraphRepository() *InMemoryGraphRepository {
	return &InMemoryGraphRepository{}
}

func (r *InMemoryGraphRepository) SaveSnapshot(ctx context.Context, sessionID string, g *domain.Graph) error {
	_ = ctx
	_ = sessionID
	_ = g
	return nil
}

func (r *InMemoryGraphRepository) LoadSnapshot(ctx context.Context, sessionID string) (*domain.Graph, error) {
	_ = ctx
	_ = sessionID
	return nil, domain.ErrNotFound
}

func cloneProject(p *domain.Project) *domain.Project {
	if p == nil {
		return nil
	}
	cp := *p
	return &cp
}

func cloneSession(s *domain.Session) *domain.Session {
	if s == nil {
		return nil
	}
	cp := *s
	return &cp
}
