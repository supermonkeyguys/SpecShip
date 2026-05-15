package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/supermonkeyguys/specship/apps/server-go/internal/app"
)

type PlanHandler struct {
	Service *app.PlanService
}

func (h PlanHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Spec string `json:"spec"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, err.Error())
		return
	}
	out, err := h.Service.Generate(r.Context(), req.Spec)
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
