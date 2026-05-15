package app

import (
    "context"

    appruntime "github.com/supermonkeyguys/specship/apps/server-go/internal/runtime"
)

type CheckpointService struct {
    Runtime RuntimeManager
}

func (s *CheckpointService) Approve(ctx context.Context, sessionID, nodeID string) error {
    return s.Runtime.Send(ctx, sessionID, appruntime.ApproveCheckpointCommand{NodeID: nodeID})
}
