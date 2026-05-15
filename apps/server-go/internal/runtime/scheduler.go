package runtime

import "context"

type Scheduler interface {
    ExecuteNode(ctx context.Context, sessionID string, nodeID string) (<-chan NodeResult, error)
}
