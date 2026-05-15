package http

import stdhttp "net/http"

func WithLogging(next stdhttp.Handler) stdhttp.Handler {
    return next
}
