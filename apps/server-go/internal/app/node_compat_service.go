package app

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/supermonkeyguys/specship/apps/server-go/internal/domain"
	"github.com/supermonkeyguys/specship/apps/server-go/internal/infra/llm"
	"github.com/supermonkeyguys/specship/apps/server-go/internal/infra/toolrunner"
	appruntime "github.com/supermonkeyguys/specship/apps/server-go/internal/runtime"
)

type NodeCompatService struct {
	Projects      ProjectRepository
	Sessions      SessionRepository
	Graphs        GraphRepository
	Runtime       RuntimeManager
	WorkspaceDir  string
	Reviewer      llm.Client
	ReviewerModel string
}

type SessionRetryOutput struct {
	OK        bool   `json:"ok"`
	GraphID   string `json:"graphId,omitempty"`
	ProjectID string `json:"projectId,omitempty"`
	SessionID string `json:"sessionId,omitempty"`
	Error     string `json:"error,omitempty"`
}

type SimpleOKResponse struct {
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
}

type NodeEditImpact struct {
	ChangedNodeID   string                `json:"changedNodeId"`
	ChangeKind      domain.NodeChangeKind `json:"changeKind"`
	Description     string                `json:"description"`
	NodesStillValid []domain.ImpactEntry  `json:"nodesStillValid"`
	NodesNeedRerun  []domain.ImpactEntry  `json:"nodesNeedRerun"`
	TotalAffected   int                   `json:"totalAffected"`
	TotalUnaffected int                   `json:"totalUnaffected"`
}

type NodeEditResponse struct {
	OK     bool            `json:"ok"`
	Impact *NodeEditImpact `json:"impact,omitempty"`
	Error  string          `json:"error,omitempty"`
}

func (s *NodeCompatService) RetrySession(ctx context.Context, projectID, sessionID string) (*SessionRetryOutput, error) {
	if strings.TrimSpace(projectID) == "" || strings.TrimSpace(sessionID) == "" {
		return &SessionRetryOutput{OK: false, Error: "projectId and sessionId are required"}, nil
	}
	sess, err := s.Sessions.Get(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	if sess.ProjectID != projectID {
		return &SessionRetryOutput{OK: false, Error: "session does not belong to project"}, nil
	}
	graph, err := s.Graphs.LoadSnapshot(ctx, sessionID)
	if err != nil {
		return nil, err
	}

	failedNodeIDs := make([]string, 0)
	for _, node := range graph.Nodes {
		if node.Status == domain.NodeFailed || node.Status == domain.NodeBlocked {
			failedNodeIDs = append(failedNodeIDs, node.ID)
		}
	}
	if len(failedNodeIDs) > 0 {
		sort.Strings(failedNodeIDs)
		for _, nodeID := range failedNodeIDs {
			if err := s.Runtime.Send(ctx, sessionID, appruntime.RetryNodeCommand{NodeID: nodeID}); err != nil {
				return nil, err
			}
		}
		return &SessionRetryOutput{OK: true, GraphID: graph.ID, ProjectID: projectID, SessionID: sessionID}, nil
	}

	if sess.Status == domain.SessionPaused || sess.Status == domain.SessionInterrupted {
		if err := s.Runtime.Send(ctx, sessionID, appruntime.ResumeCommand{}); err != nil {
			return nil, err
		}
		return &SessionRetryOutput{OK: true, GraphID: graph.ID, ProjectID: projectID, SessionID: sessionID}, nil
	}

	return &SessionRetryOutput{OK: false, Error: "session has no failed nodes to retry"}, nil
}

func (s *NodeCompatService) RetryNode(ctx context.Context, projectID, sessionID, nodeID string) (*SimpleOKResponse, error) {
	if strings.TrimSpace(projectID) == "" || strings.TrimSpace(sessionID) == "" {
		return &SimpleOKResponse{OK: false, Error: "projectId and sessionId are required"}, nil
	}
	if strings.TrimSpace(nodeID) == "" {
		return &SimpleOKResponse{OK: false, Error: "nodeId is required"}, nil
	}
	if _, err := s.Sessions.Get(ctx, sessionID); err != nil {
		return nil, err
	}
	if err := s.Runtime.Send(ctx, sessionID, appruntime.RetryNodeCommand{NodeID: nodeID}); err != nil {
		return nil, err
	}
	return &SimpleOKResponse{OK: true}, nil
}

func (s *NodeCompatService) VerifyNode(ctx context.Context, projectID, sessionID, nodeID string) (*SimpleOKResponse, error) {
	if strings.TrimSpace(projectID) == "" || strings.TrimSpace(sessionID) == "" {
		return &SimpleOKResponse{OK: false, Error: "projectId and sessionId are required"}, nil
	}
	if strings.TrimSpace(nodeID) == "" {
		return &SimpleOKResponse{OK: false, Error: "nodeId is required"}, nil
	}
	graph, err := s.Graphs.LoadSnapshot(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	node := graph.Nodes[nodeID]
	if node == nil {
		return &SimpleOKResponse{OK: false, Error: fmt.Sprintf("node not found: %s", nodeID)}, nil
	}

	sess, err := s.Sessions.Get(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	root := ResolveSessionExecutionRoot(ctx, s.Projects, sess, s.WorkspaceDir)
	runner := toolrunner.NewLocalClient(root)
	verifier := appruntime.NewBasicVerifier(runner, s.Reviewer, s.ReviewerModel, root)
	outcome, err := verifier.VerifyNode(ctx, graph, node)
	if err != nil {
		return nil, err
	}
	if node.Evidence == nil {
		node.Evidence = &domain.Evidence{}
	}
	node.Evidence.Verifications = append(node.Evidence.Verifications, outcome.Records...)
	now := time.Now().UTC()
	node.UpdatedAt = now
	graph.UpdatedAt = now
	if err := s.Graphs.SaveSnapshot(ctx, sessionID, graph); err != nil {
		return nil, err
	}
	if outcome.Passed {
		return &SimpleOKResponse{OK: true}, nil
	}
	return &SimpleOKResponse{OK: false, Error: summarizeVerifyFailure(outcome)}, nil
}

func (s *NodeCompatService) EditNode(ctx context.Context, projectID, sessionID, nodeID string, updates domain.NodeUpdate) (*NodeEditResponse, error) {
	if strings.TrimSpace(projectID) == "" || strings.TrimSpace(sessionID) == "" {
		return &NodeEditResponse{OK: false, Error: "projectId and sessionId are required"}, nil
	}
	if strings.TrimSpace(nodeID) == "" {
		return &NodeEditResponse{OK: false, Error: "nodeId is required"}, nil
	}
	graph, err := s.Graphs.LoadSnapshot(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	updated, impact, err := domain.EditNodeAndRecalculate(graph, nodeID, updates)
	if err != nil {
		return &NodeEditResponse{OK: false, Error: err.Error()}, nil
	}
	if err := s.Graphs.SaveSnapshot(ctx, sessionID, updated); err != nil {
		return nil, err
	}
	return &NodeEditResponse{OK: true, Impact: &NodeEditImpact{
		ChangedNodeID:   impact.ChangedNodeID,
		ChangeKind:      impact.ChangeKind,
		Description:     impact.Description,
		NodesStillValid: impact.NodesStillValid,
		NodesNeedRerun:  impact.NodesNeedRerun,
		TotalAffected:   impact.TotalAffected,
		TotalUnaffected: impact.TotalUnaffected,
	}}, nil
}

func summarizeVerifyFailure(outcome *appruntime.VerificationOutcome) string {
	if outcome == nil {
		return "verification failed"
	}
	if strings.TrimSpace(outcome.FailureSummary) != "" {
		return strings.TrimSpace(outcome.FailureSummary)
	}
	failed := make([]string, 0)
	for _, record := range outcome.Records {
		if !record.Passed {
			failed = append(failed, fmt.Sprintf("%s: %s", record.Type, strings.TrimSpace(record.Output)))
		}
	}
	if len(failed) == 0 {
		return "verification failed"
	}
	sort.Strings(failed)
	return strings.Join(failed, "; ")
}
