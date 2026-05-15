package app

import (
    "context"

    "github.com/supermonkeyguys/specship/apps/server-go/internal/domain"
)

type SessionService struct {
    Sessions SessionRepository
    Graphs   GraphRepository
    Events   EventStore
}

type SessionDetail struct {
    Session *domain.Session  `json:"session"`
    Graph   *domain.Graph    `json:"graph,omitempty"`
    Events  []domain.Event   `json:"events"`
}

func (s *SessionService) Get(ctx context.Context, sessionID string) (*SessionDetail, error) {
    sess, err := s.Sessions.Get(ctx, sessionID)
    if err != nil {
        return nil, err
    }

    graph, err := s.Graphs.LoadSnapshot(ctx, sessionID)
    if err != nil && err != domain.ErrNotFound {
        return nil, err
    }
    if err == domain.ErrNotFound {
        graph = nil
    }

    events, err := s.Events.List(ctx, sessionID, 0)
    if err != nil {
        return nil, err
    }

    return &SessionDetail{
        Session: sess,
        Graph:   graph,
        Events:  events,
    }, nil
}
