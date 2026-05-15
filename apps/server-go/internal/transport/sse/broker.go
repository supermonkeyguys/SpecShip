package sse

import (
	"context"
	"sync"
)

type Event struct {
	SessionID string
	Revision  int64
	Type      string
	Data      []byte
}

type Broker interface {
	Publish(ctx context.Context, evt Event) error
	Subscribe(ctx context.Context, sessionID string, afterRevision int64) (<-chan Event, error)
	SubscribeAll(ctx context.Context) (<-chan Event, error)
}

type InMemoryBroker struct {
	mu          sync.Mutex
	subscribers map[string]map[chan Event]struct{}
	global      map[chan Event]struct{}
}

func NewInMemoryBroker() *InMemoryBroker {
	return &InMemoryBroker{subscribers: map[string]map[chan Event]struct{}{}, global: map[chan Event]struct{}{}}
}

func (b *InMemoryBroker) Publish(ctx context.Context, evt Event) error {
	_ = ctx
	b.mu.Lock()
	defer b.mu.Unlock()

	subs := b.subscribers[evt.SessionID]
	for ch := range subs {
		select {
		case ch <- evt:
		default:
		}
	}
	for ch := range b.global {
		select {
		case ch <- evt:
		default:
		}
	}
	return nil
}

func (b *InMemoryBroker) Subscribe(ctx context.Context, sessionID string, afterRevision int64) (<-chan Event, error) {
	_ = afterRevision
	ch := make(chan Event, 32)

	b.mu.Lock()
	if _, ok := b.subscribers[sessionID]; !ok {
		b.subscribers[sessionID] = map[chan Event]struct{}{}
	}
	b.subscribers[sessionID][ch] = struct{}{}
	b.mu.Unlock()

	go func() {
		<-ctx.Done()
		b.mu.Lock()
		delete(b.subscribers[sessionID], ch)
		if len(b.subscribers[sessionID]) == 0 {
			delete(b.subscribers, sessionID)
		}
		b.mu.Unlock()
		close(ch)
	}()

	return ch, nil
}

func (b *InMemoryBroker) SubscribeAll(ctx context.Context) (<-chan Event, error) {
	ch := make(chan Event, 64)
	b.mu.Lock()
	b.global[ch] = struct{}{}
	b.mu.Unlock()

	go func() {
		<-ctx.Done()
		b.mu.Lock()
		delete(b.global, ch)
		b.mu.Unlock()
		close(ch)
	}()

	return ch, nil
}
