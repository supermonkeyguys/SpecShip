package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"

	"github.com/supermonkeyguys/specship/apps/server-go/internal/app"
	appsse "github.com/supermonkeyguys/specship/apps/server-go/internal/transport/sse"
)

type StreamHandler struct {
	Events           app.EventStore
	Broker           appsse.Broker
	WebCompatService *app.WebCompatService
}

func (h StreamHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	sessionID := r.URL.Query().Get("sessionId")
	if sessionID == "" {
		h.serveCompatStream(w, r)
		return
	}

	afterRevision := int64(0)
	if raw := r.URL.Query().Get("afterRevision"); raw != "" {
		parsed, err := strconv.ParseInt(raw, 10, 64)
		if err != nil {
			http.Error(w, "invalid afterRevision", http.StatusBadRequest)
			return
		}
		afterRevision = parsed
	}

	setupSSEHeaders(w)
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	historical, err := h.Events.List(r.Context(), sessionID, afterRevision)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	lastRevision := afterRevision
	for _, evt := range historical {
		payload, _ := json.Marshal(map[string]any{
			"sessionId": evt.SessionID,
			"revision":  evt.Revision,
			"type":      evt.Type,
			"data":      json.RawMessage(evt.Payload),
		})
		_, _ = fmt.Fprintf(w, "data: %s\n\n", payload)
		if evt.Revision > lastRevision {
			lastRevision = evt.Revision
		}
	}
	flusher.Flush()

	live, err := h.Broker.Subscribe(r.Context(), sessionID, lastRevision)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	for evt := range live {
		if evt.Revision <= lastRevision {
			continue
		}
		payload, _ := json.Marshal(map[string]any{
			"sessionId": evt.SessionID,
			"revision":  evt.Revision,
			"type":      evt.Type,
			"data":      json.RawMessage(evt.Data),
		})
		_, _ = fmt.Fprintf(w, "data: %s\n\n", payload)
		flusher.Flush()
		lastRevision = evt.Revision
	}
}

func (h StreamHandler) serveCompatStream(w http.ResponseWriter, r *http.Request) {
	if h.WebCompatService == nil || h.Broker == nil {
		http.Error(w, "compat stream unavailable", http.StatusInternalServerError)
		return
	}
	setupSSEHeaders(w)
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	live, err := h.Broker.SubscribeAll(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	_, _ = fmt.Fprintf(w, ": connected\n\n")
	flusher.Flush()
	for evt := range live {
		projected, err := h.WebCompatService.ProjectRealtimeEvent(r.Context(), evt.SessionID, evt.Type, evt.Data)
		if err != nil || projected == nil {
			continue
		}
		payload, _ := json.Marshal(projected)
		_, _ = fmt.Fprintf(w, "data: %s\n\n", payload)
		flusher.Flush()
	}
}

func setupSSEHeaders(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
}
