package toolrunner

import (
	"bytes"
	"context"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/supermonkeyguys/specship/apps/server-go/internal/workspacepath"
)

type LocalClient struct {
	RootDir string
}

func NewLocalClient(rootDir string) *LocalClient {
	return &LocalClient{RootDir: workspacepath.Root(rootDir, "")}
}

func (c *LocalClient) WriteFile(ctx context.Context, req WriteFileRequest) (*WriteFileResponse, error) {
	target, rel, err := c.resolvePath(req.SessionID, req.RelativePath)
	if err != nil {
		return nil, err
	}
	if err := c.ensureAllowed(rel, req.AllowedWrites); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return nil, err
	}
	if err := os.WriteFile(target, []byte(req.Content), 0o644); err != nil {
		return nil, err
	}
	return &WriteFileResponse{Success: true, Output: fmt.Sprintf("written %s", filepath.ToSlash(rel))}, nil
}

func (c *LocalClient) ReadFile(ctx context.Context, req ReadFileRequest) (*ReadFileResponse, error) {
	_ = ctx
	target, _, err := c.resolvePath(req.SessionID, req.RelativePath)
	if err != nil {
		return nil, err
	}
	raw, err := os.ReadFile(target)
	if err != nil {
		return nil, err
	}
	return &ReadFileResponse{Success: true, Output: string(raw)}, nil
}

func (c *LocalClient) SearchFiles(ctx context.Context, req SearchFilesRequest) (*SearchFilesResponse, error) {
	_ = ctx
	root := c.rootDir(req.SessionID)
	matches := make([]string, 0)
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			return nil
		}
		if strings.Contains(string(raw), req.Pattern) {
			rel, relErr := filepath.Rel(root, path)
			if relErr == nil {
				matches = append(matches, filepath.ToSlash(rel))
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &SearchFilesResponse{Success: true, Output: strings.Join(matches, "\n")}, nil
}

func (c *LocalClient) RunCommand(ctx context.Context, req RunCommandRequest) (*RunCommandResponse, error) {
	if strings.TrimSpace(req.Program) == "" {
		return nil, fmt.Errorf("program is required")
	}

	workDir, _, err := c.resolveDir(req.SessionID, firstNonEmpty(req.WorkDir, "."))
	if err != nil {
		return nil, err
	}

	runCtx := ctx
	cancel := func() {}
	if req.TimeoutMs > 0 {
		runCtx, cancel = context.WithTimeout(ctx, time.Duration(req.TimeoutMs)*time.Millisecond)
	}
	defer cancel()

	cmd := exec.CommandContext(runCtx, req.Program, req.Args...)
	cmd.Dir = workDir
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err = cmd.Run()
	exitCode := 0
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else if runCtx.Err() == context.DeadlineExceeded {
			return &RunCommandResponse{
				Success:  false,
				Stdout:   stdout.String(),
				Stderr:   strings.TrimSpace(firstNonEmpty(stderr.String(), runCtx.Err().Error())),
				ExitCode: -1,
			}, nil
		} else {
			return nil, err
		}
	}
	return &RunCommandResponse{
		Success:  err == nil,
		Stdout:   stdout.String(),
		Stderr:   stderr.String(),
		ExitCode: exitCode,
	}, nil
}

func (c *LocalClient) StartPreview(ctx context.Context, req StartPreviewRequest) (*StartPreviewResponse, error) {
	_ = ctx
	_ = req
	return &StartPreviewResponse{Success: false, URL: ""}, nil
}

func (c *LocalClient) StopPreview(ctx context.Context, req StopPreviewRequest) (*StopPreviewResponse, error) {
	_ = ctx
	_ = req
	return &StopPreviewResponse{Success: true}, nil
}

func (c *LocalClient) resolvePath(sessionID string, path string) (string, string, error) {
	return c.resolveDir(sessionID, path)
}

func (c *LocalClient) resolveDir(sessionID string, path string) (string, string, error) {
	return workspacepath.Resolve(c.rootDir(sessionID), path)
}

func (c *LocalClient) rootDir(sessionID string) string {
	return workspacepath.Root(c.RootDir, sessionID)
}

func (c *LocalClient) ensureAllowed(targetRel string, allowed []string) error {
	if len(allowed) == 0 {
		return fmt.Errorf("no allowed writes configured")
	}
	normalized := filepath.ToSlash(filepath.Clean(targetRel))
	for _, allow := range allowed {
		if filepath.ToSlash(filepath.Clean(allow)) == normalized {
			return nil
		}
	}
	return fmt.Errorf("write path not allowed: %s", targetRel)
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
