package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/supermonkeyguys/specship/apps/server-go/internal/app"
)

type CompatRunHandler struct {
	Service *app.RunService
}

type CompatPRDHandler struct {
	Service *app.PRDService
}

type CompatClarifyHandler struct {
	Service *app.ClarifyService
}

type CompatChatHandler struct {
	Service *app.ChatService
}

func (h CompatRunHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Spec       string           `json:"spec"`
		RepoPath   string           `json:"repoPath,omitempty"`
		StrategyID string           `json:"strategyId,omitempty"`
		LLM        *app.LLMSettings `json:"llm,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	out, err := h.Service.StartRun(r.Context(), app.StartRunInput{
		Spec:        req.Spec,
		RepoPath:    req.RepoPath,
		StrategyID:  req.StrategyID,
		LLMSettings: req.LLM,
	})
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":        true,
		"graphId":   out.GraphID,
		"projectId": out.ProjectID,
		"sessionId": out.SessionID,
	})
}

func (h CompatPRDHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Spec string           `json:"spec"`
		LLM  *app.LLMSettings `json:"llm,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, err.Error())
		return
	}
	out, err := h.Service.GenerateWithSettings(r.Context(), req.Spec, req.LLM)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	status := http.StatusOK
	if !out.OK {
		status = http.StatusBadRequest
	}
	writeJSON(w, status, out)
}

func (h CompatClarifyHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Spec string           `json:"spec"`
		LLM  *app.LLMSettings `json:"llm,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, err.Error())
		return
	}
	out, err := h.Service.ClarifyWithSettings(r.Context(), req.Spec, req.LLM)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (h CompatChatHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		app.ChatInput
		LLM *app.LLMSettings `json:"llm,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, err.Error())
		return
	}
	out, err := h.Service.RouteWithSettings(r.Context(), req.ChatInput, req.LLM)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	status := http.StatusOK
	if !out.OK && out.Error != "" {
		status = http.StatusInternalServerError
	}
	writeJSON(w, status, out)
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeJSONError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]any{"ok": false, "error": message})
}
