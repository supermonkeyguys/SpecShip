package runtime

import (
	"context"
	"errors"
	"fmt"
	"sync"

	"github.com/supermonkeyguys/specship/apps/server-go/internal/domain"
)

type ExecutorFactory func(StartInput) Executor

type VerifierFactory func(StartInput) Verifier

type Manager struct {
	mu              sync.RWMutex
	sessions        map[string]*managedRuntime
	events          EventStore
	sessionsRepo    SessionStore
	graphs          GraphStore
	planner         Planner
	executorFactory ExecutorFactory
	verifierFactory VerifierFactory
	clock           SchedulerClock
}

type managedRuntime struct {
	runtime *SessionRuntime
	cancel  context.CancelFunc
}

func NewManager(events EventStore, sessionsRepo SessionStore, graphs GraphStore, planner Planner, executor Executor, verifier Verifier, clock SchedulerClock) *Manager {
	return NewManagerWithFactories(events, sessionsRepo, graphs, planner, func(StartInput) Executor {
		if executor == nil {
			return NewStubExecutor()
		}
		return executor
	}, func(StartInput) Verifier {
		return verifier
	}, clock)
}

func NewManagerWithFactories(events EventStore, sessionsRepo SessionStore, graphs GraphStore, planner Planner, executorFactory ExecutorFactory, verifierFactory VerifierFactory, clock SchedulerClock) *Manager {
	if executorFactory == nil {
		executorFactory = func(StartInput) Executor { return NewStubExecutor() }
	}
	if clock == nil {
		clock = RealClock{}
	}
	return &Manager{
		sessions:        map[string]*managedRuntime{},
		events:          events,
		sessionsRepo:    sessionsRepo,
		graphs:          graphs,
		planner:         planner,
		executorFactory: executorFactory,
		verifierFactory: verifierFactory,
		clock:           clock,
	}
}

func (m *Manager) Start(ctx context.Context, input StartInput) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, exists := m.sessions[input.SessionID]; exists {
		return fmt.Errorf("session runtime already exists: %s", input.SessionID)
	}

	executor := m.executorFactory(input)
	verifier := Verifier(nil)
	if m.verifierFactory != nil {
		verifier = m.verifierFactory(input)
	}

	rt := NewSessionRuntime(input, m.events, m.sessionsRepo, m.graphs, m.planner, executor, verifier, m.clock)
	if err := rt.Bootstrap(ctx); err != nil {
		return err
	}

	runCtx, cancel := context.WithCancel(context.Background())
	m.sessions[input.SessionID] = &managedRuntime{runtime: rt, cancel: cancel}
	go func() {
		_ = rt.Run(runCtx)
	}()
	return nil
}

func (m *Manager) Restore(ctx context.Context, input StartInput, status domain.SessionStatus, graph *domain.Graph) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, exists := m.sessions[input.SessionID]; exists {
		return nil
	}

	executor := m.executorFactory(input)
	verifier := Verifier(nil)
	if m.verifierFactory != nil {
		verifier = m.verifierFactory(input)
	}

	rt := NewSessionRuntime(input, m.events, m.sessionsRepo, m.graphs, m.planner, executor, verifier, m.clock)
	normalizeRecoveredGraph(graph, status, m.clock.Now())
	rt.graph = graph
	if err := rt.saveSnapshot(ctx); err != nil {
		return err
	}

	runCtx, cancel := context.WithCancel(context.Background())
	m.sessions[input.SessionID] = &managedRuntime{runtime: rt, cancel: cancel}
	go func() {
		if shouldAutoResumeRecoveredSession(status, graph.Status) {
			if err := rt.tick(runCtx); err != nil {
				cancel()
				return
			}
		}
		_ = rt.Run(runCtx)
	}()
	return nil
}

func (m *Manager) Send(ctx context.Context, sessionID string, cmd Command) error {
	m.mu.RLock()
	managed, exists := m.sessions[sessionID]
	m.mu.RUnlock()
	if !exists {
		return ErrRuntimeNotFound
	}
	return managed.runtime.Send(ctx, cmd)
}

func (m *Manager) Stop(ctx context.Context, sessionID string) error {
	_ = ctx
	m.mu.Lock()
	defer m.mu.Unlock()

	managed, ok := m.sessions[sessionID]
	if !ok {
		return ErrRuntimeNotFound
	}
	managed.cancel()
	delete(m.sessions, sessionID)
	return nil
}

var ErrRuntimeNotFound = errors.New("runtime not found")
