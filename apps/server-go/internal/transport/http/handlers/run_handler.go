package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/supermonkeyguys/specship/apps/server-go/internal/app"
)

type RunHandler struct {
	Service *app.RunService
}

type StartRunRequest struct {
	Spec       string `json:"spec"`
	RepoPath   string `json:"repoPath,omitempty"`
	StrategyID string `json:"strategyId,omitempty"`
}

func (h RunHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req StartRunRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	out, err := h.Service.StartRun(r.Context(), app.StartRunInput{
		Spec:       req.Spec,
		RepoPath:   req.RepoPath,
		StrategyID: req.StrategyID,
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":        true,
		"projectId": out.ProjectID,
		"sessionId": out.SessionID,
		"graphId":   out.GraphID,
	})
}
