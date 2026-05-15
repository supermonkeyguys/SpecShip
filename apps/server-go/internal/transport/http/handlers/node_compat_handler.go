package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/supermonkeyguys/specship/apps/server-go/internal/app"
	"github.com/supermonkeyguys/specship/apps/server-go/internal/domain"
	appruntime "github.com/supermonkeyguys/specship/apps/server-go/internal/runtime"
)

type NodeCompatHandler struct {
	Service *app.NodeCompatService
}

func (h NodeCompatHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	trimmed := strings.TrimPrefix(r.URL.Path, "/api/")
	parts := strings.Split(strings.Trim(trimmed, "/"), "/")
	if len(parts) == 2 && parts[0] == "session" && parts[1] == "retry" {
		h.handleSessionRetry(w, r)
		return
	}
	if len(parts) == 3 && parts[0] == "node" && (parts[2] == "retry" || parts[2] == "verify" || parts[2] == "edit") {
		h.handleNodeAction(w, r, parts[1], parts[2])
		return
	}
	http.NotFound(w, r)
}

func (h NodeCompatHandler) handleSessionRetry(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ProjectID string `json:"projectId"`
		SessionID string `json:"sessionId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, err.Error())
		return
	}
	out, err := h.Service.RetrySession(r.Context(), req.ProjectID, req.SessionID)
	if err != nil {
		writeCompatError(w, err)
		return
	}
	status := http.StatusOK
	if !out.OK {
		status = http.StatusBadRequest
	}
	writeJSON(w, status, out)
}

func (h NodeCompatHandler) handleNodeAction(w http.ResponseWriter, r *http.Request, nodeID string, action string) {
	switch action {
	case "retry":
		var req struct {
			ProjectID string `json:"projectId"`
			SessionID string `json:"sessionId"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSONError(w, http.StatusBadRequest, err.Error())
			return
		}
		out, err := h.Service.RetryNode(r.Context(), req.ProjectID, req.SessionID, nodeID)
		if err != nil {
			writeCompatError(w, err)
			return
		}
		status := http.StatusOK
		if !out.OK {
			status = http.StatusBadRequest
		}
		writeJSON(w, status, out)
		return

	case "verify":
		var req struct {
			ProjectID string `json:"projectId"`
			SessionID string `json:"sessionId"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSONError(w, http.StatusBadRequest, err.Error())
			return
		}
		out, err := h.Service.VerifyNode(r.Context(), req.ProjectID, req.SessionID, nodeID)
		if err != nil {
			writeCompatError(w, err)
			return
		}
		status := http.StatusOK
		if !out.OK {
			status = http.StatusBadRequest
		}
		writeJSON(w, status, out)
		return

	case "edit":
		var req struct {
			ProjectID string `json:"projectId"`
			SessionID string `json:"sessionId"`
			Updates   struct {
				Title              *string  `json:"title"`
				Task               *string  `json:"task"`
				SpecFragment       *string  `json:"specFragment"`
				AcceptanceCriteria *string  `json:"acceptanceCriteria"`
				DependsOn          []string `json:"dependsOn"`
			} `json:"updates"`
		}
		decoder := json.NewDecoder(r.Body)
		if err := decoder.Decode(&req); err != nil {
			writeJSONError(w, http.StatusBadRequest, err.Error())
			return
		}
		updates := domain.NodeUpdate{
			Title:              req.Updates.Title,
			Task:               req.Updates.Task,
			SpecFragment:       req.Updates.SpecFragment,
			AcceptanceCriteria: req.Updates.AcceptanceCriteria,
			DependsOn:          req.Updates.DependsOn,
			DependsOnSet:       req.Updates.DependsOn != nil,
		}
		out, err := h.Service.EditNode(r.Context(), req.ProjectID, req.SessionID, nodeID, updates)
		if err != nil {
			writeCompatError(w, err)
			return
		}
		status := http.StatusOK
		if !out.OK {
			status = http.StatusBadRequest
		}
		writeJSON(w, status, out)
		return
	}

	http.NotFound(w, r)
}

func writeCompatError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, domain.ErrNotFound):
		writeJSONError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, appruntime.ErrRuntimeNotFound):
		writeJSONError(w, http.StatusNotFound, err.Error())
	default:
		writeJSONError(w, http.StatusBadRequest, err.Error())
	}
}
