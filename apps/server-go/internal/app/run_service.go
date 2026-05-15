package app

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/supermonkeyguys/specship/apps/server-go/internal/domain"
	llminfra "github.com/supermonkeyguys/specship/apps/server-go/internal/infra/llm"
	appruntime "github.com/supermonkeyguys/specship/apps/server-go/internal/runtime"
)

type RunService struct {
	Sessions SessionRepository
	Runtime  RuntimeManager
	Projects ProjectRepository
}

type StartRunInput struct {
	Spec        string
	RepoPath    string
	StrategyID  string
	LLMSettings *llminfra.Settings
}

type StartRunOutput struct {
	ProjectID string `json:"projectId"`
	SessionID string `json:"sessionId"`
	GraphID   string `json:"graphId"`
}

func (s *RunService) StartRun(ctx context.Context, in StartRunInput) (*StartRunOutput, error) {
	spec := strings.TrimSpace(in.Spec)
	if spec == "" {
		return nil, fmt.Errorf("spec is required")
	}

	now := time.Now().UTC()
	projectID := domain.NewProjectID(now)
	sessionID := domain.NewSessionID(now)
	graphID := domain.NewGraphID(now)

	projectName := spec
	if len(projectName) > 40 {
		projectName = projectName[:40]
	}

	project := &domain.Project{
		ID:        projectID,
		Name:      projectName,
		RepoPath:  in.RepoPath,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := s.Projects.Create(ctx, project); err != nil {
		return nil, err
	}

	session := &domain.Session{
		ID:        sessionID,
		ProjectID: projectID,
		Spec:      spec,
		Status:    domain.SessionRunning,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := s.Sessions.Create(ctx, session); err != nil {
		return nil, err
	}

	if err := s.Runtime.Start(ctx, appruntime.StartInput{
		ProjectID:   projectID,
		SessionID:   sessionID,
		GraphID:     graphID,
		Title:       projectName,
		Spec:        spec,
		RepoPath:    in.RepoPath,
		StrategyID:  in.StrategyID,
		LLMSettings: in.LLMSettings,
	}); err != nil {
		return nil, err
	}

	return &StartRunOutput{
		ProjectID: projectID,
		SessionID: sessionID,
		GraphID:   graphID,
	}, nil
}
