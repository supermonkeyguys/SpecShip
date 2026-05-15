package handlers

import (
	"errors"
	"mime"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/supermonkeyguys/specship/apps/server-go/internal/app"
	"github.com/supermonkeyguys/specship/apps/server-go/internal/domain"
)

type PreviewHandler struct {
	Service *app.PreviewService
}

func (h PreviewHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	trimmed := strings.TrimPrefix(r.URL.Path, "/api/projects/")
	parts := strings.Split(strings.Trim(trimmed, "/"), "/")
	if len(parts) < 4 || parts[1] != "sessions" || parts[3] != "preview" {
		http.NotFound(w, r)
		return
	}
	projectID := parts[0]
	sessionID := parts[2]

	switch {
	case len(parts) == 4 && r.Method == http.MethodGet:
		h.handleStatus(w, r, projectID, sessionID)
	case len(parts) == 6 && parts[4] == "live" && parts[5] == "start" && r.Method == http.MethodPost:
		h.handleStartLive(w, r, projectID, sessionID)
	case len(parts) == 6 && parts[4] == "live" && parts[5] == "stop" && r.Method == http.MethodPost:
		h.handleStopLive(w, r, projectID, sessionID)
	case len(parts) >= 5 && parts[4] == "content" && r.Method == http.MethodGet:
		h.handleContent(w, r, projectID, sessionID, parts[5:])
	default:
		http.NotFound(w, r)
	}
}

func (h PreviewHandler) handleStatus(w http.ResponseWriter, r *http.Request, projectID, sessionID string) {
	out, err := h.Service.GetStatus(r.Context(), projectID, sessionID)
	if err != nil {
		writePreviewError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (h PreviewHandler) handleStartLive(w http.ResponseWriter, r *http.Request, projectID, sessionID string) {
	out, err := h.Service.StartLivePreview(r.Context(), projectID, sessionID)
	if err != nil {
		writePreviewError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (h PreviewHandler) handleStopLive(w http.ResponseWriter, r *http.Request, projectID, sessionID string) {
	out, err := h.Service.StopLivePreview(r.Context(), projectID, sessionID)
	if err != nil {
		writePreviewError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (h PreviewHandler) handleContent(w http.ResponseWriter, r *http.Request, projectID, sessionID string, rest []string) {
	if len(rest) == 0 {
		writeJSONError(w, http.StatusBadRequest, "preview path required")
		return
	}
	relPath := strings.Join(rest, "/")
	data, isHTML, err := h.Service.ReadPreviewContent(r.Context(), projectID, sessionID, relPath)
	if err != nil {
		writePreviewError(w, err)
		return
	}
	if isHTML {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(data)
		return
	}
	if contentType := mime.TypeByExtension(strings.ToLower(filepath.Ext(relPath))); contentType != "" {
		w.Header().Set("Content-Type", contentType)
		if strings.HasPrefix(contentType, "text/") {
			w.Header().Set("Content-Type", contentType+"; charset=utf-8")
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(data)
		return
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

func writePreviewError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, domain.ErrNotFound):
		writeJSONError(w, http.StatusNotFound, err.Error())
	default:
		writeJSONError(w, http.StatusBadRequest, err.Error())
	}
}
