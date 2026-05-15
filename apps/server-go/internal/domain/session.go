package domain

import "time"

type SessionStatus string

const (
	SessionRunning     SessionStatus = "running"
	SessionPaused      SessionStatus = "paused"
	SessionDone        SessionStatus = "done"
	SessionFailed      SessionStatus = "failed"
	SessionInterrupted SessionStatus = "interrupted"
)

type Session struct {
	ID        string
	ProjectID string
	Spec      string
	Status    SessionStatus
	Starred   bool
	CreatedAt time.Time
	UpdatedAt time.Time
}

type Project struct {
	ID        string
	Name      string
	RepoPath  string
	CreatedAt time.Time
	UpdatedAt time.Time
}
