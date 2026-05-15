package workspacepath

import (
	"fmt"
	"path/filepath"
	"strings"
)

func Root(baseDir, sessionID string) string {
	root := strings.TrimSpace(baseDir)
	if root == "" {
		root = "./workspace"
	}
	if strings.TrimSpace(sessionID) != "" {
		root = filepath.Join(root, "sessions", sessionID)
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		return filepath.Clean(root)
	}
	return filepath.Clean(abs)
}

func Resolve(rootDir, relPath string) (string, string, error) {
	root := Root(rootDir, "")
	candidate := strings.TrimSpace(relPath)
	if candidate == "" {
		candidate = "."
	}

	var full string
	if filepath.IsAbs(candidate) {
		full = filepath.Clean(candidate)
	} else {
		full = filepath.Join(root, candidate)
	}

	rel, err := filepath.Rel(root, full)
	if err != nil {
		return "", "", err
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", "", fmt.Errorf("path escapes root")
	}
	return full, filepath.Clean(rel), nil
}

func IsWithin(rootDir, fullPath string) bool {
	root := Root(rootDir, "")
	rel, err := filepath.Rel(root, fullPath)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}
