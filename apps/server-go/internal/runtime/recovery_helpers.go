package runtime

import (
	"time"

	"github.com/supermonkeyguys/specship/apps/server-go/internal/domain"
)

func normalizeRecoveredGraph(g *domain.Graph, sessionStatus domain.SessionStatus, now time.Time) {
	if g == nil {
		return
	}
	if g.Nodes == nil {
		g.Nodes = map[string]*domain.Node{}
	}

	originalStatus := g.Status
	for _, node := range g.Nodes {
		if node == nil {
			continue
		}
		if shouldKeepCheckpointWaiting(node, sessionStatus, originalStatus) {
			continue
		}
		if node.Status == domain.NodeRunning || node.Status == domain.NodeVerifying {
			node.Status = domain.NodeReady
			node.UpdatedAt = now
			node.LastErrorKind = ""
		}
	}

	switch sessionStatus {
	case domain.SessionPaused:
		g.Status = domain.GraphPaused
	case domain.SessionFailed:
		g.Status = domain.GraphFailed
	case domain.SessionDone:
		g.Status = domain.GraphDone
	default:
		if g.Status == domain.GraphBuilding || g.Status == "" {
			g.Status = domain.GraphRunning
		}
	}

	if g.Status != domain.GraphDone {
		g.CompletedAt = nil
	}
	domain.UpdatePendingNodes(g, now)
	g.UpdatedAt = now
}

func shouldKeepCheckpointWaiting(node *domain.Node, sessionStatus domain.SessionStatus, graphStatus domain.GraphStatus) bool {
	return node != nil &&
		node.Type == domain.NodeCheckpoint &&
		node.Status == domain.NodeRunning &&
		sessionStatus == domain.SessionPaused &&
		graphStatus == domain.GraphPaused
}

func shouldAutoResumeRecoveredSession(status domain.SessionStatus, graphStatus domain.GraphStatus) bool {
	if status != domain.SessionRunning {
		return false
	}
	return graphStatus != domain.GraphPaused && graphStatus != domain.GraphFailed && graphStatus != domain.GraphDone
}
