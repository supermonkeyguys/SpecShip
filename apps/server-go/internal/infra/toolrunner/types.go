package toolrunner

type ToolExecution struct {
    Tool     string
    Success  bool
    Output   string
    FilePath string
}

type WriteFileRequest struct {
    SessionID     string
    RelativePath  string
    Content       string
    AllowedWrites []string
}

type WriteFileResponse struct {
    Success bool
    Output  string
}

type ReadFileRequest struct {
    SessionID    string
    RelativePath string
}

type ReadFileResponse struct {
    Success bool
    Output  string
}

type SearchFilesRequest struct {
    SessionID string
    Pattern   string
    Glob      string
}

type SearchFilesResponse struct {
    Success bool
    Output  string
}

type RunCommandRequest struct {
    SessionID string
    WorkDir   string
    Program   string
    Args      []string
    TimeoutMs int
}

type RunCommandResponse struct {
    Success  bool
    Stdout   string
    Stderr   string
    ExitCode int
}

type StartPreviewRequest struct {
    SessionID string
}

type StartPreviewResponse struct {
    Success bool
    URL     string
}

type StopPreviewRequest struct {
    SessionID string
}

type StopPreviewResponse struct {
    Success bool
}
