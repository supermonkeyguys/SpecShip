package app

import (
	"context"
	"fmt"
	"strings"

	"github.com/supermonkeyguys/specship/apps/server-go/internal/domain"
	appruntime "github.com/supermonkeyguys/specship/apps/server-go/internal/runtime"
)

type RuntimeRecoverer interface {
	Restore(ctx context.Context, input appruntime.StartInput, status domain.SessionStatus, graph *domain.Graph) error
}

func RecoverActiveSessions(ctx context.Context, runtime RuntimeRecoverer, projects ProjectRepository, sessions SessionRepository, graphs GraphRepository) error {
	if runtime == nil || projects == nil || sessions == nil || graphs == nil {
		return nil
	}

	projectList, err := projects.List(ctx)
	if err != nil {
		return err
	}

	for _, project := range projectList {
		projectSessions, err := sessions.ListByProject(ctx, project.ID)
		if err != nil {
			return err
		}
		for _, sess := range projectSessions {
			if !shouldRecoverSessionStatus(sess.Status) {
				continue
			}
			graph, err := graphs.LoadSnapshot(ctx, sess.ID)
			if err != nil {
				if err == domain.ErrNotFound {
					continue
				}
				return err
			}
			if graph == nil {
				continue
			}
			if err := runtime.Restore(ctx, appruntime.StartInput{
				ProjectID: project.ID,
				SessionID: sess.ID,
				GraphID:   firstNonEmptyRecovery(graph.ID, sess.ID),
				Title:     firstNonEmptyRecovery(graph.Title, project.Name, sess.Spec),
				Spec:      firstNonEmptyRecovery(graph.OriginalSpec, sess.Spec, graph.Title),
				RepoPath:  project.RepoPath,
			}, sess.Status, graph); err != nil {
				return fmt.Errorf("restore session %s: %w", sess.ID, err)
			}
		}
	}
	return nil
}

func shouldRecoverSessionStatus(status domain.SessionStatus) bool {
	switch status {
	case domain.SessionRunning, domain.SessionPaused, domain.SessionFailed, domain.SessionInterrupted:
		return true
	default:
		return false
	}
}

func firstNonEmptyRecovery(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
