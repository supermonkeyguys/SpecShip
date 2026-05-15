package domain

import "time"

func DependenciesSatisfied(g *Graph, node *Node) bool {
    for _, depID := range node.DependsOn {
        dep, ok := g.Nodes[depID]
        if !ok || dep.Status != NodeDone {
            return false
        }
    }
    return true
}

func ReadyNodes(g *Graph) []*Node {
    out := make([]*Node, 0)
    for _, node := range g.Nodes {
        if node.Status == NodeReady && DependenciesSatisfied(g, node) {
            out = append(out, node)
        }
    }
    return out
}

func UpdatePendingNodes(g *Graph, now time.Time) {
    for _, node := range g.Nodes {
        if node.Status == NodePending && DependenciesSatisfied(g, node) {
            node.Status = NodeReady
            node.UpdatedAt = now
        }
    }
}

func IsGraphDone(g *Graph) bool {
    if len(g.Nodes) == 0 {
        return false
    }
    for _, node := range g.Nodes {
        if node.Status != NodeDone && node.Status != NodeSkipped {
            return false
        }
    }
    return true
}
