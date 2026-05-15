package domain

import "time"

type GraphStatus string

const (
    GraphBuilding GraphStatus = "building"
    GraphRunning  GraphStatus = "running"
    GraphPaused   GraphStatus = "paused"
    GraphDone     GraphStatus = "done"
    GraphFailed   GraphStatus = "failed"
)

type Graph struct {
    ID           string
    Title        string
    OriginalSpec string
    Status       GraphStatus
    Nodes        map[string]*Node
    CreatedAt    time.Time
    UpdatedAt    time.Time
    CompletedAt  *time.Time
}
