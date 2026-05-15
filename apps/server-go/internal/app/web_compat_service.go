package app

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/supermonkeyguys/specship/apps/server-go/internal/domain"
)

type WebCompatService struct {
	Projects ProjectRepository
	Sessions SessionRepository
	Graphs   GraphRepository
	Events   EventStore
}

type SessionGraphResponse struct {
	OK     bool            `json:"ok"`
	Nodes  []WebNodeStatus `json:"nodes"`
	Title  string          `json:"title"`
	Status string          `json:"status"`
}

type StatusResponse struct {
	IsRunning bool   `json:"isRunning"`
	CanResume bool   `json:"canResume"`
	Spec      string `json:"spec,omitempty"`
	NodeCount int    `json:"nodeCount,omitempty"`
	DoneCount int    `json:"doneCount,omitempty"`
	ProjectID string `json:"projectId,omitempty"`
	SessionID string `json:"sessionId,omitempty"`
}

type WebNodeStatus struct {
	ID                 string                  `json:"id"`
	Title              string                  `json:"title"`
	Status             string                  `json:"status"`
	NodeType           string                  `json:"nodeType"`
	NodeRole           string                  `json:"nodeRole,omitempty"`
	Task               string                  `json:"task,omitempty"`
	AcceptanceCriteria string                  `json:"acceptanceCriteria,omitempty"`
	SpecFragment       string                  `json:"specFragment"`
	DependsOn          []string                `json:"dependsOn"`
	FilesWritten       []string                `json:"filesWritten"`
	ToolCalls          []WebToolCall           `json:"toolCalls,omitempty"`
	Verifications      []WebVerificationRecord `json:"verifications"`
	RetryCount         int                     `json:"retryCount"`
	MaxRetries         int                     `json:"maxRetries"`
	Error              string                  `json:"error,omitempty"`
	DurationMs         int64                   `json:"durationMs,omitempty"`
}

type WebToolCall struct {
	Tool      string         `json:"tool"`
	Input     map[string]any `json:"input"`
	Output    string         `json:"output"`
	Success   bool           `json:"success"`
	Timestamp string         `json:"timestamp"`
}

type WebVerificationRecord struct {
	Type    string `json:"type"`
	Passed  bool   `json:"passed"`
	Summary string `json:"summary"`
}

func (s *WebCompatService) GetSessionGraph(ctx context.Context, projectID, sessionID string) (*SessionGraphResponse, error) {
	sess, err := s.Sessions.Get(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	if projectID != "" && sess.ProjectID != projectID {
		return nil, fmt.Errorf("session does not belong to project")
	}
	graph, err := s.Graphs.LoadSnapshot(ctx, sessionID)
	if err != nil {
		if err == domain.ErrNotFound {
			return &SessionGraphResponse{OK: true, Nodes: []WebNodeStatus{}, Title: sess.Spec, Status: string(sess.Status)}, nil
		}
		return nil, err
	}
	nodes := make([]WebNodeStatus, 0, len(graph.Nodes))
	for _, node := range graph.Nodes {
		nodes = append(nodes, toWebNodeStatus(node))
	}
	sort.Slice(nodes, func(i, j int) bool { return nodes[i].ID < nodes[j].ID })
	return &SessionGraphResponse{OK: true, Nodes: nodes, Title: graph.Title, Status: string(graph.Status)}, nil
}

func (s *WebCompatService) GetStatus(ctx context.Context) (*StatusResponse, error) {
	projects, err := s.Projects.List(ctx)
	if err != nil {
		return nil, err
	}

	var latest *domain.Session
	for _, project := range projects {
		sessions, err := s.Sessions.ListByProject(ctx, project.ID)
		if err != nil {
			return nil, err
		}
		for _, sess := range sessions {
			if sess == nil {
				continue
			}
			if latest == nil || sess.CreatedAt.After(latest.CreatedAt) || (sess.CreatedAt.Equal(latest.CreatedAt) && sess.UpdatedAt.After(latest.UpdatedAt)) {
				cp := *sess
				latest = &cp
			}
		}
	}
	if latest == nil {
		return &StatusResponse{IsRunning: false, CanResume: false}, nil
	}

	resp := &StatusResponse{
		IsRunning: latest.Status == domain.SessionRunning,
		CanResume: latest.Status == domain.SessionPaused || latest.Status == domain.SessionInterrupted || latest.Status == domain.SessionFailed,
		Spec:      latest.Spec,
		ProjectID: latest.ProjectID,
		SessionID: latest.ID,
	}
	if graph, err := s.Graphs.LoadSnapshot(ctx, latest.ID); err == nil && graph != nil {
		resp.NodeCount = len(graph.Nodes)
		doneCount := 0
		for _, node := range graph.Nodes {
			if node.Status == domain.NodeDone {
				doneCount++
			}
		}
		resp.DoneCount = doneCount
	}
	return resp, nil
}

func toWebNodeStatus(node *domain.Node) WebNodeStatus {
	toolCalls := make([]WebToolCall, 0, len(evidenceToolCalls(node)))
	for _, call := range evidenceToolCalls(node) {
		toolCalls = append(toolCalls, WebToolCall{
			Tool:      call.Tool,
			Input:     map[string]any{"raw": call.InputJSON},
			Output:    call.Output,
			Success:   call.Success,
			Timestamp: call.At.Format(timeLayout),
		})
	}
	verifications := make([]WebVerificationRecord, 0, len(evidenceVerifications(node)))
	for _, record := range evidenceVerifications(node) {
		verifications = append(verifications, WebVerificationRecord{
			Type:    record.Type,
			Passed:  record.Passed,
			Summary: record.Output,
		})
	}
	filesWritten := make([]string, 0, len(evidenceFilesWritten(node)))
	for _, file := range evidenceFilesWritten(node) {
		filesWritten = append(filesWritten, file.Path)
	}
	specFragment := firstNonEmptyCompat(node.Task, node.Title)
	durationMs := int64(0)
	if node.Evidence != nil {
		durationMs = node.Evidence.DurationMs
	}
	return WebNodeStatus{
		ID:                 node.ID,
		Title:              node.Title,
		Status:             string(node.Status),
		NodeType:           string(node.Type),
		NodeRole:           node.Role,
		Task:               node.Task,
		AcceptanceCriteria: node.AcceptanceCriteria,
		SpecFragment:       specFragment,
		DependsOn:          append([]string{}, node.DependsOn...),
		FilesWritten:       filesWritten,
		ToolCalls:          toolCalls,
		Verifications:      verifications,
		RetryCount:         node.RetryCount,
		MaxRetries:         node.MaxRetries,
		Error:              node.LastError,
		DurationMs:         durationMs,
	}
}

func evidenceToolCalls(node *domain.Node) []domain.ToolCall {
	if node.Evidence == nil {
		return nil
	}
	return node.Evidence.ToolCalls
}

func evidenceVerifications(node *domain.Node) []domain.VerificationRecord {
	if node.Evidence == nil {
		return nil
	}
	return node.Evidence.Verifications
}

func evidenceFilesWritten(node *domain.Node) []domain.FileRecord {
	if node.Evidence == nil {
		return nil
	}
	return node.Evidence.FilesWritten
}

func firstNonEmptyCompat(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

type WebSSEEvent struct {
	Type      string `json:"type"`
	Payload   any    `json:"payload"`
	ProjectID string `json:"projectId,omitempty"`
	SessionID string `json:"sessionId,omitempty"`
}

func (s *WebCompatService) ProjectRealtimeEvent(ctx context.Context, sessionID string, eventType string, raw []byte) (*WebSSEEvent, error) {
	sess, err := s.Sessions.Get(ctx, sessionID)
	if err != nil {
		return nil, err
	}

	switch eventType {
	case "node.started", "node.verifying", "node.completed", "node.failed", "node.retry_scheduled", "checkpoint.approved":
		var payload struct {
			NodeID string `json:"nodeId"`
		}
		if err := json.Unmarshal(raw, &payload); err != nil {
			return nil, err
		}
		graph, err := s.Graphs.LoadSnapshot(ctx, sessionID)
		if err != nil {
			return nil, err
		}
		node := graph.Nodes[payload.NodeID]
		if node == nil {
			return nil, nil
		}
		return &WebSSEEvent{Type: "node_update", Payload: toWebNodeStatus(node), ProjectID: sess.ProjectID, SessionID: sessionID}, nil

	case "graph.completed", "graph.failed":
		graph, err := s.Graphs.LoadSnapshot(ctx, sessionID)
		if err != nil {
			return nil, err
		}
		payload := buildGraphSummary(sess, graph)
		typeName := "graph_done"
		if eventType == "graph.failed" {
			typeName = "graph_failed"
		}
		return &WebSSEEvent{Type: typeName, Payload: payload, ProjectID: sess.ProjectID, SessionID: sessionID}, nil

	default:
		return &WebSSEEvent{Type: "log", Payload: eventType, ProjectID: sess.ProjectID, SessionID: sessionID}, nil
	}
}

func buildGraphSummary(sess *domain.Session, graph *domain.Graph) map[string]any {
	total := len(graph.Nodes)
	done := 0
	failed := 0
	filesGenerated := 0
	verificationsRun := 0
	verificationsPassed := 0
	for _, node := range graph.Nodes {
		if node.Status == domain.NodeDone {
			done++
		}
		if node.Status == domain.NodeFailed {
			failed++
		}
		if node.Evidence != nil {
			filesGenerated += len(node.Evidence.FilesWritten)
			for _, record := range node.Evidence.Verifications {
				verificationsRun++
				if record.Passed {
					verificationsPassed++
				}
			}
		}
	}
	durationMs := int64(0)
	if !sess.CreatedAt.IsZero() {
		durationMs = time.Since(sess.CreatedAt).Milliseconds()
	}
	status := string(graph.Status)
	if status != "done" && status != "failed" {
		if failed > 0 {
			status = "failed"
		} else {
			status = "done"
		}
	}
	return map[string]any{
		"id":     graph.ID,
		"title":  graph.Title,
		"status": status,
		"stats": map[string]any{
			"total":               total,
			"done":                done,
			"failed":              failed,
			"filesGenerated":      filesGenerated,
			"verificationsPassed": verificationsPassed,
			"verificationsRun":    verificationsRun,
		},
		"durationMs": durationMs,
	}
}
