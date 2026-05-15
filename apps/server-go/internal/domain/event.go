package domain

import (
    "encoding/json"
    "time"
)

type EventType string

const (
    EventSessionCreated      EventType = "session.created"
    EventGraphInitialized    EventType = "graph.initialized"
    EventGraphPaused         EventType = "graph.paused"
    EventGraphCompleted      EventType = "graph.completed"
    EventGraphFailed         EventType = "graph.failed"
    EventNodeStarted         EventType = "node.started"
    EventNodeVerifying       EventType = "node.verifying"
    EventNodeCompleted       EventType = "node.completed"
    EventNodeFailed          EventType = "node.failed"
    EventCheckpointResumed   EventType = "checkpoint.resumed"
    EventNodeRetryScheduled  EventType = "node.retry_scheduled"
    EventCheckpointApproved  EventType = "checkpoint.approved"
)

type Event struct {
    ID        string
    SessionID string
    Revision  int64
    Type      string
    Payload   json.RawMessage
    CreatedAt time.Time
}
