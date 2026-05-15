package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/supermonkeyguys/specship/apps/server-go/internal/app"
	"github.com/supermonkeyguys/specship/apps/server-go/internal/domain"
)

type ProjectMutationHandler struct {
	Service *app.ProjectMutationService
}

func (h ProjectMutationHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	trimmed := strings.TrimPrefix(r.URL.Path, "/api/projects/")
	parts := strings.Split(strings.Trim(trimmed, "/"), "/")
	if len(parts) == 1 && r.Method == http.MethodDelete {
		h.handleDeleteProject(w, r, parts[0])
		return
	}
	if len(parts) == 3 && parts[1] == "sessions" {
		switch r.Method {
		case http.MethodDelete:
			h.handleDeleteSession(w, r, parts[0], parts[2])
			return
		case http.MethodPatch:
			h.handlePatchSession(w, r, parts[0], parts[2])
			return
		}
	}
	http.NotFound(w, r)
}

func (h ProjectMutationHandler) handleDeleteProject(w http.ResponseWriter, r *http.Request, projectID string) {
	if err := h.Service.DeleteProject(r.Context(), projectID); err != nil {
		writeProjectMutationError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h ProjectMutationHandler) handleDeleteSession(w http.ResponseWriter, r *http.Request, projectID, sessionID string) {
	if err := h.Service.DeleteSession(r.Context(), projectID, sessionID); err != nil {
		writeProjectMutationError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h ProjectMutationHandler) handlePatchSession(w http.ResponseWriter, r *http.Request, projectID, sessionID string) {
	var req struct {
		Starred *bool `json:"starred"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.Starred != nil {
		if err := h.Service.UpdateSessionStarred(r.Context(), projectID, sessionID, *req.Starred); err != nil {
			writeProjectMutationError(w, err)
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func writeProjectMutationError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, domain.ErrNotFound):
		writeJSONError(w, http.StatusNotFound, err.Error())
	default:
		writeJSONError(w, http.StatusBadRequest, err.Error())
	}
}
