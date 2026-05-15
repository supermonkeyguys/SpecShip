package handlers

import (
	"errors"
	"net/http"
	"strings"

	"github.com/supermonkeyguys/specship/apps/server-go/internal/app"
	"github.com/supermonkeyguys/specship/apps/server-go/internal/domain"
)

type FileHandler struct {
	Service *app.FileService
}

func (h FileHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	trimmed := strings.TrimPrefix(r.URL.Path, "/api/projects/")
	parts := strings.Split(strings.Trim(trimmed, "/"), "/")
	if len(parts) != 4 || parts[1] != "sessions" || (parts[3] != "files" && parts[3] != "file") {
		http.NotFound(w, r)
		return
	}
	projectID := parts[0]
	sessionID := parts[2]
	if parts[3] == "files" {
		h.handleList(w, r, projectID, sessionID)
		return
	}
	if parts[3] == "file" {
		h.handleRead(w, r, projectID, sessionID)
		return
	}
	http.NotFound(w, r)
}

func (h FileHandler) handleList(w http.ResponseWriter, r *http.Request, projectID, sessionID string) {
	out, err := h.Service.ListSessionFiles(r.Context(), projectID, sessionID)
	if err != nil {
		writeFileError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (h FileHandler) handleRead(w http.ResponseWriter, r *http.Request, projectID, sessionID string) {
	path := r.URL.Query().Get("path")
	if strings.TrimSpace(path) == "" {
		writeJSONError(w, http.StatusBadRequest, "path query param required")
		return
	}
	out, err := h.Service.ReadSessionFile(r.Context(), projectID, sessionID, path)
	if err != nil {
		writeFileError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func writeFileError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, domain.ErrNotFound):
		writeJSONError(w, http.StatusNotFound, err.Error())
	default:
		writeJSONError(w, http.StatusBadRequest, err.Error())
	}
}
