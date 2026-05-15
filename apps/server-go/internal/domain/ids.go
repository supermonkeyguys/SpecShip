package domain

import (
    "encoding/json"
    "fmt"
    "time"
)

func NewProjectID(now time.Time) string {
    return fmt.Sprintf("proj-%d", now.UnixMilli())
}

func NewSessionID(now time.Time) string {
    return fmt.Sprintf("sess-%d", now.UnixMilli())
}

func NewGraphID(now time.Time) string {
    return fmt.Sprintf("graph-%d", now.UnixMilli())
}

func NewEventID(now time.Time, kind string) string {
    return fmt.Sprintf("evt-%s-%d", kind, now.UnixNano())
}

func MustJSON(v any) json.RawMessage {
    b, err := json.Marshal(v)
    if err != nil {
        panic(err)
    }
    return b
}
