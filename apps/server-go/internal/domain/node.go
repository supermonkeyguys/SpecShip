package domain

import "time"

type NodeStatus string

type NodeType string

type ErrorKind string

const (
    NodePending   NodeStatus = "pending"
    NodeReady     NodeStatus = "ready"
    NodeRunning   NodeStatus = "running"
    NodeVerifying NodeStatus = "verifying"
    NodeDone      NodeStatus = "done"
    NodeFailed    NodeStatus = "failed"
    NodeBlocked   NodeStatus = "blocked"
    NodeSkipped   NodeStatus = "skipped"
)

const (
    NodeImplement  NodeType = "implement"
    NodeCheckpoint NodeType = "checkpoint"
)

const (
    ErrorFatal  ErrorKind = "fatal"
    ErrorVerify ErrorKind = "verify"
    ErrorReview ErrorKind = "review"
)

type Node struct {
    ID                 string
    Type               NodeType
    Title              string
    Role               string
    Task               string
    AcceptanceCriteria string
    DependsOn          []string
    Outputs            []string
    Status             NodeStatus
    RetryCount         int
    MaxRetries         int
    LastError          string
    LastErrorKind      ErrorKind
    Evidence           *Evidence
    CreatedAt          time.Time
    UpdatedAt          time.Time
}

type Evidence struct {
    ModelUsed     string
    ToolCalls     []ToolCall
    FilesWritten  []FileRecord
    Verifications []VerificationRecord
    StartedAt     time.Time
    CompletedAt   *time.Time
    DurationMs    int64
}

type ToolCall struct {
    Tool      string
    InputJSON string
    Output    string
    Success   bool
    At        time.Time
}

type FileRecord struct {
    Path      string
    Operation string
    SizeBytes int64
    Checksum  string
    At        time.Time
}

type VerificationRecord struct {
    Type       string
    Passed     bool
    Output     string
    DurationMs int64
    At         time.Time
}
