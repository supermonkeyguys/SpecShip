package handlers

import (
    "encoding/json"
    "net/http"
)

type HealthHandler struct{}

func (HealthHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/json")
    _ = json.NewEncoder(w).Encode(map[string]any{
        "ok":      true,
        "service": "server-go",
    })
}
