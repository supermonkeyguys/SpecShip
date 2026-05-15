package handlers

import (
    "encoding/json"
    "errors"
    "net/http"
    "strings"

    "github.com/supermonkeyguys/specship/apps/server-go/internal/app"
    appruntime "github.com/supermonkeyguys/specship/apps/server-go/internal/runtime"
)

type RunCommandHandler struct {
    ResumeService     *app.ResumeService
    RetryService      *app.RetryService
    CheckpointService *app.CheckpointService
}

func (h RunCommandHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    if r.Method != http.MethodPost {
        http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
        return
    }

    trimmed := strings.TrimPrefix(r.URL.Path, "/api/runs/")
    parts := strings.Split(trimmed, "/")
    if len(parts) < 2 {
        http.NotFound(w, r)
        return
    }

    sessionID := parts[0]
    switch {
    case len(parts) == 2 && parts[1] == "resume":
        if err := h.ResumeService.Resume(r.Context(), sessionID); err != nil {
            writeRuntimeError(w, err)
            return
        }
        writeOK(w)
        return

    case len(parts) == 4 && parts[1] == "nodes" && parts[3] == "retry":
        nodeID := parts[2]
        if err := h.RetryService.RetryNode(r.Context(), sessionID, nodeID); err != nil {
            writeRuntimeError(w, err)
            return
        }
        writeOK(w)
        return

    case len(parts) == 4 && parts[1] == "checkpoints" && parts[3] == "approve":
        nodeID := parts[2]
        if err := h.CheckpointService.Approve(r.Context(), sessionID, nodeID); err != nil {
            writeRuntimeError(w, err)
            return
        }
        writeOK(w)
        return

    default:
        http.NotFound(w, r)
        return
    }
}

func writeOK(w http.ResponseWriter) {
    w.Header().Set("Content-Type", "application/json")
    _ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
}

func writeRuntimeError(w http.ResponseWriter, err error) {
    if errors.Is(err, appruntime.ErrRuntimeNotFound) {
        http.Error(w, err.Error(), http.StatusNotFound)
        return
    }
    http.Error(w, err.Error(), http.StatusBadRequest)
}
