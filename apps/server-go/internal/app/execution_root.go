package app

import (
	"context"
	"path/filepath"
	"strings"

	"github.com/supermonkeyguys/specship/apps/server-go/internal/domain"
	"github.com/supermonkeyguys/specship/apps/server-go/internal/workspacepath"
)

func ResolveExecutionRoot(baseWorkspaceDir, repoPath, sessionID string) string {
	if strings.TrimSpace(repoPath) != "" {
		if abs, err := filepath.Abs(strings.TrimSpace(repoPath)); err == nil {
			return filepath.Clean(abs)
		}
		return filepath.Clean(strings.TrimSpace(repoPath))
	}
	return workspacepath.Root(baseWorkspaceDir, sessionID)
}

func ResolveSessionExecutionRoot(ctx context.Context, projects ProjectRepository, sess *domain.Session, baseWorkspaceDir string) string {
	if sess != nil && projects != nil && strings.TrimSpace(sess.ProjectID) != "" {
		if project, err := projects.Get(ctx, sess.ProjectID); err == nil && project != nil {
			return ResolveExecutionRoot(baseWorkspaceDir, project.RepoPath, sess.ID)
		}
	}
	if sess == nil {
		return ResolveExecutionRoot(baseWorkspaceDir, "", "")
	}
	return ResolveExecutionRoot(baseWorkspaceDir, "", sess.ID)
}
