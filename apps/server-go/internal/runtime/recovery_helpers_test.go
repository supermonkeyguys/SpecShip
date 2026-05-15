package runtime

import (
	"testing"
	"time"

	"github.com/supermonkeyguys/specship/apps/server-go/internal/domain"
)

func TestNormalizeRecoveredGraphResetsActiveImplementNodesToReady(t *testing.T) {
	now := time.Now().UTC()
	g := &domain.Graph{Status: domain.GraphRunning, Nodes: map[string]*domain.Node{
		"impl":   {ID: "impl", Type: domain.NodeImplement, Status: domain.NodeRunning},
		"verify": {ID: "verify", Type: domain.NodeImplement, Status: domain.NodeVerifying},
	}}
	normalizeRecoveredGraph(g, domain.SessionRunning, now)
	if g.Nodes["impl"].Status != domain.NodeReady || g.Nodes["verify"].Status != domain.NodeReady {
		t.Fatalf("expected active nodes reset to ready, got impl=%s verify=%s", g.Nodes["impl"].Status, g.Nodes["verify"].Status)
	}
}

func TestNormalizeRecoveredGraphKeepsPausedCheckpointWaiting(t *testing.T) {
	now := time.Now().UTC()
	g := &domain.Graph{Status: domain.GraphPaused, Nodes: map[string]*domain.Node{
		"plan-1": {ID: "plan-1", Type: domain.NodeCheckpoint, Status: domain.NodeRunning},
	}}
	normalizeRecoveredGraph(g, domain.SessionPaused, now)
	if g.Nodes["plan-1"].Status != domain.NodeRunning {
		t.Fatalf("expected paused checkpoint to remain running, got %s", g.Nodes["plan-1"].Status)
	}
}
