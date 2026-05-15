package runtime

import (
    "context"

    "github.com/supermonkeyguys/specship/apps/server-go/internal/domain"
)

type EventPublisher interface {
    Publish(ctx context.Context, evt domain.Event) error
}
