package app

import (
	"context"
	"sync"
)

type InMemoryLLMSettingsStore struct {
	mu       sync.RWMutex
	settings LLMSettings
}

func NewInMemoryLLMSettingsStore(initial LLMSettings) *InMemoryLLMSettingsStore {
	return &InMemoryLLMSettingsStore{settings: initial}
}

func (s *InMemoryLLMSettingsStore) Load(ctx context.Context) (*LLMSettings, error) {
	_ = ctx
	s.mu.RLock()
	defer s.mu.RUnlock()
	copy := s.settings
	return &copy, nil
}

func (s *InMemoryLLMSettingsStore) Save(ctx context.Context, settings LLMSettings) error {
	_ = ctx
	s.mu.Lock()
	defer s.mu.Unlock()
	s.settings = settings
	return nil
}
