package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/supermonkeyguys/specship/apps/server-go/internal/app"
)

type LLMSettingsHandler struct {
	Service *app.LLMSettingsService
}

func (h LLMSettingsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		out, err := h.Service.Get(r.Context())
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, out)
	case http.MethodPost:
		var req struct {
			BaseURL string `json:"baseURL"`
			APIKey  string `json:"apiKey"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSONError(w, http.StatusBadRequest, err.Error())
			return
		}
		out, err := h.Service.Save(r.Context(), app.LLMSettings{BaseURL: req.BaseURL, APIKey: req.APIKey})
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, out)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}
