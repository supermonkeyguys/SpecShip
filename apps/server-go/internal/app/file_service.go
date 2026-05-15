package app

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/supermonkeyguys/specship/apps/server-go/internal/domain"
)

type FileService struct {
	Projects     ProjectRepository
	Sessions     SessionRepository
	Graphs       GraphRepository
	WorkspaceDir string
}

type FileEntry struct {
	Path      string `json:"path"`
	SizeBytes int64  `json:"sizeBytes"`
	UpdatedAt string `json:"updatedAt"`
}

type FilesOutput struct {
	Files []FileEntry `json:"files"`
}

type FileContentOutput struct {
	Content string `json:"content"`
}

func (s *FileService) ListSessionFiles(ctx context.Context, projectID, sessionID string) (*FilesOutput, error) {
	sess, graph, err := s.loadSessionGraph(ctx, projectID, sessionID)
	if err != nil {
		return nil, err
	}
	root := ResolveSessionExecutionRoot(ctx, s.Projects, sess, s.WorkspaceDir)

	seen := map[string]struct{}{}
	paths := make([]string, 0)
	for _, path := range collectGraphFileCandidates(graph) {
		cleaned, ok := sanitizeRelativePath(path)
		if !ok {
			continue
		}
		if _, exists := seen[cleaned]; exists {
			continue
		}
		seen[cleaned] = struct{}{}
		paths = append(paths, cleaned)
	}

	entries := make([]FileEntry, 0, len(paths))
	for _, rel := range paths {
		full := filepath.Join(root, rel)
		info, err := os.Stat(full)
		if err != nil || info.IsDir() {
			continue
		}
		entries = append(entries, FileEntry{
			Path:      filepath.ToSlash(rel),
			SizeBytes: info.Size(),
			UpdatedAt: info.ModTime().UTC().Format(time.RFC3339Nano),
		})
	}

	if len(entries) == 0 {
		entries = s.scanFallbackOutputDir(root)
	}

	sort.Slice(entries, func(i, j int) bool { return entries[i].Path < entries[j].Path })
	return &FilesOutput{Files: entries}, nil
}

func (s *FileService) ReadSessionFile(ctx context.Context, projectID, sessionID, relPath string) (*FileContentOutput, error) {
	sess, _, err := s.loadSessionGraph(ctx, projectID, sessionID)
	if err != nil {
		return nil, err
	}
	cleaned, ok := sanitizeRelativePath(relPath)
	if !ok {
		return nil, fmt.Errorf("invalid path")
	}
	full := filepath.Join(ResolveSessionExecutionRoot(ctx, s.Projects, sess, s.WorkspaceDir), cleaned)
	data, err := os.ReadFile(full)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	return &FileContentOutput{Content: string(data)}, nil
}

func (s *FileService) loadSessionGraph(ctx context.Context, projectID, sessionID string) (*domain.Session, *domain.Graph, error) {
	sess, err := s.Sessions.Get(ctx, sessionID)
	if err != nil {
		return nil, nil, err
	}
	if strings.TrimSpace(projectID) != "" && sess.ProjectID != projectID {
		return nil, nil, fmt.Errorf("session does not belong to project")
	}
	graph, err := s.Graphs.LoadSnapshot(ctx, sessionID)
	if err != nil {
		if err == domain.ErrNotFound {
			return sess, &domain.Graph{Nodes: map[string]*domain.Node{}}, nil
		}
		return nil, nil, err
	}
	if graph.Nodes == nil {
		graph.Nodes = map[string]*domain.Node{}
	}
	return sess, graph, nil
}

func collectGraphFileCandidates(graph *domain.Graph) []string {
	if graph == nil {
		return nil
	}
	paths := make([]string, 0)
	for _, node := range graph.Nodes {
		if node == nil {
			continue
		}
		paths = append(paths, node.Outputs...)
		if node.Evidence != nil {
			for _, record := range node.Evidence.FilesWritten {
				paths = append(paths, record.Path)
			}
		}
	}
	return paths
}

func sanitizeRelativePath(path string) (string, bool) {
	cleaned := filepath.Clean(strings.TrimSpace(path))
	if cleaned == "." || cleaned == "" {
		return "", false
	}
	if filepath.IsAbs(cleaned) {
		return "", false
	}
	if strings.HasPrefix(cleaned, "..") || strings.Contains(cleaned, ".."+string(filepath.Separator)) {
		return "", false
	}
	return filepath.ToSlash(cleaned), true
}

func (s *FileService) scanFallbackOutputDir(workspaceRoot string) []FileEntry {
	root := filepath.Join(workspaceRoot, "output")
	info, err := os.Stat(root)
	if err != nil || !info.IsDir() {
		return []FileEntry{}
	}
	entries := make([]FileEntry, 0)
	_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		name := d.Name()
		if d.IsDir() {
			if ignoredDir(name) {
				return filepath.SkipDir
			}
			return nil
		}
		if ignoredFile(name) {
			return nil
		}
		info, statErr := d.Info()
		if statErr != nil {
			return nil
		}
		rel, relErr := filepath.Rel(workspaceRoot, path)
		if relErr != nil {
			return nil
		}
		entries = append(entries, FileEntry{
			Path:      filepath.ToSlash(rel),
			SizeBytes: info.Size(),
			UpdatedAt: info.ModTime().UTC().Format(time.RFC3339Nano),
		})
		return nil
	})
	return entries
}

func (s *FileService) workspaceDir() string {
	root := strings.TrimSpace(s.WorkspaceDir)
	if root == "" {
		root = "./workspace"
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		return root
	}
	return abs
}

func ignoredDir(name string) bool {
	switch name {
	case "node_modules", ".git", "dist", "build", ".cache", ".next", ".turbo":
		return true
	default:
		return false
	}
}

func ignoredFile(name string) bool {
	switch name {
	case ".DS_Store", "package-lock.json", "yarn.lock", "pnpm-lock.yaml":
		return true
	default:
		return false
	}
}
