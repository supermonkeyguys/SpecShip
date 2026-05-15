package handlers

import (
    "encoding/json"
    "net/http"

    "github.com/supermonkeyguys/specship/apps/server-go/internal/app"
)

type ProjectHandler struct {
    Service *app.ProjectService
}

func (h ProjectHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    if r.Method != http.MethodGet {
        http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
        return
    }

    out, err := h.Service.List(r.Context())
    if err != nil {
        http.Error(w, err.Error(), http.StatusInternalServerError)
        return
    }

    w.Header().Set("Content-Type", "application/json")
    _ = json.NewEncoder(w).Encode(map[string]any{
        "projects": out,
    })
}
