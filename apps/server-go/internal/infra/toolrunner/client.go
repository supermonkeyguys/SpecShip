package toolrunner

import "context"

type Client interface {
    WriteFile(ctx context.Context, req WriteFileRequest) (*WriteFileResponse, error)
    ReadFile(ctx context.Context, req ReadFileRequest) (*ReadFileResponse, error)
    SearchFiles(ctx context.Context, req SearchFilesRequest) (*SearchFilesResponse, error)
    RunCommand(ctx context.Context, req RunCommandRequest) (*RunCommandResponse, error)
    StartPreview(ctx context.Context, req StartPreviewRequest) (*StartPreviewResponse, error)
    StopPreview(ctx context.Context, req StopPreviewRequest) (*StopPreviewResponse, error)
}
