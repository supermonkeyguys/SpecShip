package runtime

import "github.com/supermonkeyguys/specship/apps/server-go/internal/domain"

type NodeResult struct {
    NodeID      string
    Evidence    *domain.Evidence
    OutputFiles []string
    FatalError  string
}
