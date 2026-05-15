package domain

func CanTransition(from, to NodeStatus) bool {
    valid := map[NodeStatus][]NodeStatus{
        NodePending:   {NodeReady, NodeBlocked},
        NodeReady:     {NodeRunning},
        NodeRunning:   {NodeVerifying, NodeDone, NodeFailed, NodeReady},
        NodeVerifying: {NodeDone, NodeFailed},
        NodeDone:      {},
        NodeFailed:    {NodeReady},
        NodeBlocked:   {NodePending},
        NodeSkipped:   {},
    }

    for _, next := range valid[from] {
        if next == to {
            return true
        }
    }
    return false
}
