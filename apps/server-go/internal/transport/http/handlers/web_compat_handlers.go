package handlers

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/supermonkeyguys/specship/apps/server-go/internal/app"
)

type WebCompatStatusHandler struct {
	Service *app.WebCompatService
}

type WebCompatResumeHandler struct {
	ResumeService *app.ResumeService
	StatusService *app.WebCompatService
}

type WebCompatGraphHandler struct {
	Service *app.WebCompatService
}

func (h WebCompatStatusHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	out, err := h.Service.GetStatus(r.Context())
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (h WebCompatResumeHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		ProjectID string `json:"projectId"`
		SessionID string `json:"sessionId"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	if strings.TrimSpace(req.SessionID) == "" && h.StatusService != nil {
		status, err := h.StatusService.GetStatus(r.Context())
		if err == nil {
			req.SessionID = status.SessionID
			req.ProjectID = status.ProjectID
		}
	}
	if strings.TrimSpace(req.SessionID) == "" {
		writeJSONError(w, http.StatusBadRequest, "sessionId is required")
		return
	}
	if err := h.ResumeService.Resume(r.Context(), req.SessionID); err != nil {
		writeJSONError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":        true,
		"projectId": req.ProjectID,
		"sessionId": req.SessionID,
	})
}

func (h WebCompatGraphHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	trimmed := strings.TrimPrefix(r.URL.Path, "/api/projects/")
	parts := strings.Split(strings.Trim(trimmed, "/"), "/")
	if len(parts) != 4 || parts[1] != "sessions" || parts[3] != "graph" {
		http.NotFound(w, r)
		return
	}
	projectID := parts[0]
	sessionID := parts[2]
	out, err := h.Service.GetSessionGraph(r.Context(), projectID, sessionID)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, out)
}
