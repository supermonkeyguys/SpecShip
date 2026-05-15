package app

import (
    "context"

    appruntime "github.com/supermonkeyguys/specship/apps/server-go/internal/runtime"
)

type RetryService struct {
    Runtime RuntimeManager
}

func (s *RetryService) RetryNode(ctx context.Context, sessionID, nodeID string) error {
    return s.Runtime.Send(ctx, sessionID, appruntime.RetryNodeCommand{NodeID: nodeID})
}
