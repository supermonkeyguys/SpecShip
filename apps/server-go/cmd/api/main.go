package main

import (
	"log"
	"net/http"

	"github.com/supermonkeyguys/specship/apps/server-go/internal/config"
	apphttp "github.com/supermonkeyguys/specship/apps/server-go/internal/transport/http"
)

func main() {
	cfg := config.Default()
	router := apphttp.NewRouter()

	log.Printf("shipyard server-go listening on %s", cfg.HTTPAddr)
	if err := http.ListenAndServe(cfg.HTTPAddr, router); err != nil {
		log.Fatal(err)
	}
}
