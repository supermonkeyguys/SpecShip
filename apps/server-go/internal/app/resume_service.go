package app

import (
    "context"

    appruntime "github.com/supermonkeyguys/specship/apps/server-go/internal/runtime"
)

type ResumeService struct {
    Runtime RuntimeManager
}

func (s *ResumeService) Resume(ctx context.Context, sessionID string) error {
    return s.Runtime.Send(ctx, sessionID, appruntime.ResumeCommand{})
}
