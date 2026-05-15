package handlers

import (
    "encoding/json"
    "errors"
    "net/http"
    "strings"

    "github.com/supermonkeyguys/specship/apps/server-go/internal/app"
    "github.com/supermonkeyguys/specship/apps/server-go/internal/domain"
)

type SessionHandler struct {
    Service *app.SessionService
}

func (h SessionHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    if r.Method != http.MethodGet {
        http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
        return
    }

    sessionID := strings.TrimPrefix(r.URL.Path, "/api/sessions/")
    sessionID = strings.Trim(sessionID, "/")
    if sessionID == "" {
        http.NotFound(w, r)
        return
    }

    out, err := h.Service.Get(r.Context(), sessionID)
    if err != nil {
        if errors.Is(err, domain.ErrNotFound) {
            http.Error(w, err.Error(), http.StatusNotFound)
            return
        }
        http.Error(w, err.Error(), http.StatusInternalServerError)
        return
    }

    w.Header().Set("Content-Type", "application/json")
    _ = json.NewEncoder(w).Encode(out)
}
