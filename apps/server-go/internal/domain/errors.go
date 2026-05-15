package domain

import "errors"

var (
    ErrNotFound       = errors.New("not found")
    ErrInvalidState   = errors.New("invalid state")
    ErrRevisionConflict = errors.New("revision conflict")
)
