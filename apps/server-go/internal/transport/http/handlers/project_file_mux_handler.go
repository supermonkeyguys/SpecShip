package handlers

import (
	"net/http"
	"strings"
)

type ProjectFileMuxHandler struct {
	GraphHandler           http.Handler
	FileHandler            http.Handler
	PreviewHandler         http.Handler
	ProjectMutationHandler http.Handler
}

func (h ProjectFileMuxHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimSuffix(r.URL.Path, "/")
	switch {
	case strings.HasSuffix(path, "/graph"):
		h.GraphHandler.ServeHTTP(w, r)
	case strings.HasSuffix(path, "/files"), strings.HasSuffix(path, "/file"):
		h.FileHandler.ServeHTTP(w, r)
	case strings.Contains(path, "/preview"):
		h.PreviewHandler.ServeHTTP(w, r)
	case r.Method == http.MethodDelete || r.Method == http.MethodPatch:
		h.ProjectMutationHandler.ServeHTTP(w, r)
	default:
		http.NotFound(w, r)
	}
}
