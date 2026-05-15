package domain

import (
	"fmt"
	"sort"
	"strings"
	"time"
)

type NodeChangeKind string

const (
	NodeChangeContent    NodeChangeKind = "content"
	NodeChangeDependency NodeChangeKind = "dependency"
	NodeChangeCriteria   NodeChangeKind = "criteria"
	NodeChangeMixed      NodeChangeKind = "mixed"
)

type ImpactEntry struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Reason string `json:"reason"`
}

type ChangeImpact struct {
	ChangedNodeID   string         `json:"changedNodeId"`
	ChangeKind      NodeChangeKind `json:"changeKind"`
	Description     string         `json:"description"`
	NodesStillValid []ImpactEntry  `json:"nodesStillValid"`
	NodesNeedRerun  []ImpactEntry  `json:"nodesNeedRerun"`
	TotalAffected   int            `json:"totalAffected"`
	TotalUnaffected int            `json:"totalUnaffected"`
}

type NodeUpdate struct {
	Title              *string
	Task               *string
	SpecFragment       *string
	AcceptanceCriteria *string
	DependsOn          []string
	DependsOnSet       bool
}

func ComputeAffectedNodeIDs(g *Graph, changedNodeID string) map[string]struct{} {
	affected := map[string]struct{}{changedNodeID: {}}
	queue := []string{changedNodeID}
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		for _, node := range g.Nodes {
			if _, ok := affected[node.ID]; ok {
				continue
			}
			for _, depID := range node.DependsOn {
				if depID == current {
					affected[node.ID] = struct{}{}
					queue = append(queue, node.ID)
					break
				}
			}
		}
	}
	return affected
}

func AnalyzeChangeImpact(g *Graph, nodeID string, kind NodeChangeKind, description string) ChangeImpact {
	affected := ComputeAffectedNodeIDs(g, nodeID)
	nodesNeedRerun := make([]ImpactEntry, 0)
	nodesStillValid := make([]ImpactEntry, 0)

	for _, node := range g.Nodes {
		if _, ok := affected[node.ID]; ok {
			reason := fmt.Sprintf("Depends on changed node path")
			if node.ID == nodeID {
				reason = fmt.Sprintf("This node was modified (%s change)", kind)
			}
			nodesNeedRerun = append(nodesNeedRerun, ImpactEntry{ID: node.ID, Title: node.Title, Reason: reason})
		} else {
			reason := "Does not depend on any changed node"
			if len(node.DependsOn) == 0 {
				reason = "Root node, unaffected by downstream changes"
			}
			nodesStillValid = append(nodesStillValid, ImpactEntry{ID: node.ID, Title: node.Title, Reason: reason})
		}
	}

	sort.Slice(nodesNeedRerun, func(i, j int) bool { return nodesNeedRerun[i].ID < nodesNeedRerun[j].ID })
	sort.Slice(nodesStillValid, func(i, j int) bool { return nodesStillValid[i].ID < nodesStillValid[j].ID })

	return ChangeImpact{
		ChangedNodeID:   nodeID,
		ChangeKind:      kind,
		Description:     description,
		NodesStillValid: nodesStillValid,
		NodesNeedRerun:  nodesNeedRerun,
		TotalAffected:   len(nodesNeedRerun),
		TotalUnaffected: len(nodesStillValid),
	}
}

func EditNodeAndRecalculate(g *Graph, nodeID string, updates NodeUpdate) (*Graph, ChangeImpact, error) {
	node := g.Nodes[nodeID]
	if node == nil {
		return nil, ChangeImpact{}, fmt.Errorf("node not found: %s", nodeID)
	}

	kind := classifyNodeChange(node, updates)
	description := buildNodeChangeDescription(node, updates, kind)
	now := time.Now().UTC()

	if updates.Title != nil {
		node.Title = strings.TrimSpace(*updates.Title)
	}
	if updates.Task != nil {
		node.Task = strings.TrimSpace(*updates.Task)
	}
	if updates.SpecFragment != nil {
		node.Task = strings.TrimSpace(*updates.SpecFragment)
	}
	if updates.AcceptanceCriteria != nil {
		node.AcceptanceCriteria = strings.TrimSpace(*updates.AcceptanceCriteria)
	}
	if updates.DependsOnSet {
		node.DependsOn = append([]string{}, updates.DependsOn...)
	}
	if strings.TrimSpace(node.Title) == "" {
		node.Title = node.ID
	}
	node.UpdatedAt = now

	impact := AnalyzeChangeImpact(g, nodeID, kind, description)
	affected := ComputeAffectedNodeIDs(g, nodeID)
	for affectedID := range affected {
		affectedNode := g.Nodes[affectedID]
		if affectedNode == nil {
			continue
		}
		affectedNode.Status = NodeReady
		affectedNode.RetryCount = 0
		affectedNode.LastError = ""
		affectedNode.LastErrorKind = ""
		affectedNode.Evidence = nil
		affectedNode.UpdatedAt = now
	}
	g.Status = GraphRunning
	g.CompletedAt = nil
	g.UpdatedAt = now
	UpdatePendingNodes(g, now)
	return g, impact, nil
}

func classifyNodeChange(existing *Node, updates NodeUpdate) NodeChangeKind {
	contentChanged := false
	criteriaChanged := false
	depsChanged := false

	if updates.Title != nil && strings.TrimSpace(*updates.Title) != existing.Title {
		contentChanged = true
	}
	if updates.Task != nil && strings.TrimSpace(*updates.Task) != existing.Task {
		contentChanged = true
	}
	if updates.SpecFragment != nil && strings.TrimSpace(*updates.SpecFragment) != existing.Task {
		contentChanged = true
	}
	if updates.AcceptanceCriteria != nil && strings.TrimSpace(*updates.AcceptanceCriteria) != existing.AcceptanceCriteria {
		criteriaChanged = true
	}
	if updates.DependsOnSet {
		left := append([]string{}, existing.DependsOn...)
		right := append([]string{}, updates.DependsOn...)
		sort.Strings(left)
		sort.Strings(right)
		depsChanged = strings.Join(left, ",") != strings.Join(right, ",")
	}

	flags := 0
	if contentChanged {
		flags++
	}
	if criteriaChanged {
		flags++
	}
	if depsChanged {
		flags++
	}
	if flags > 1 {
		return NodeChangeMixed
	}
	if depsChanged {
		return NodeChangeDependency
	}
	if criteriaChanged {
		return NodeChangeCriteria
	}
	return NodeChangeContent
}

func buildNodeChangeDescription(existing *Node, updates NodeUpdate, kind NodeChangeKind) string {
	parts := make([]string, 0)
	if updates.Title != nil && strings.TrimSpace(*updates.Title) != existing.Title {
		parts = append(parts, fmt.Sprintf("title: %q -> %q", existing.Title, strings.TrimSpace(*updates.Title)))
	}
	if updates.Task != nil && strings.TrimSpace(*updates.Task) != existing.Task {
		parts = append(parts, "task updated")
	}
	if updates.SpecFragment != nil && strings.TrimSpace(*updates.SpecFragment) != existing.Task {
		parts = append(parts, "spec fragment updated")
	}
	if updates.AcceptanceCriteria != nil && strings.TrimSpace(*updates.AcceptanceCriteria) != existing.AcceptanceCriteria {
		parts = append(parts, "acceptance criteria updated")
	}
	if updates.DependsOnSet {
		parts = append(parts, "dependencies updated")
	}
	if len(parts) == 0 {
		return string(kind) + " change"
	}
	return strings.Join(parts, "; ")
}
