package runtime

import (
	"context"
	"fmt"

	"github.com/supermonkeyguys/specship/apps/server-go/internal/domain"
)

type SessionRuntime struct {
	input       StartInput
	events      EventStore
	sessionRepo SessionStore
	graphRepo   GraphStore
	planner     Planner
	executor    Executor
	verifier    Verifier
	clock       SchedulerClock
	commands    chan Command
	graph       *domain.Graph
}

func NewSessionRuntime(input StartInput, events EventStore, sessionRepo SessionStore, graphRepo GraphStore, planner Planner, executor Executor, verifier Verifier, clock SchedulerClock) *SessionRuntime {
	return &SessionRuntime{
		input:       input,
		events:      events,
		sessionRepo: sessionRepo,
		graphRepo:   graphRepo,
		planner:     planner,
		executor:    executor,
		verifier:    verifier,
		clock:       clock,
		commands:    make(chan Command, 16),
	}
}

func (r *SessionRuntime) Bootstrap(ctx context.Context) error {
	if r.planner == nil {
		return fmt.Errorf("planner is required")
	}

	graph, err := r.planner.BuildGraph(ctx, domain.PlanInput{
		GraphID: r.input.GraphID,
		Spec:    r.input.Spec,
		Title:   r.input.Title,
		Now:     r.clock.Now(),
	})
	if err != nil {
		return err
	}
	r.graph = graph

	now := r.clock.Now()
	if err := r.appendEvents(ctx, []EventRecord{
		{
			ID:   domain.NewEventID(now, "session_created"),
			Type: string(domain.EventSessionCreated),
			Payload: domain.MustJSON(map[string]any{
				"projectId":  r.input.ProjectID,
				"sessionId":  r.input.SessionID,
				"spec":       r.input.Spec,
				"repoPath":   r.input.RepoPath,
				"strategyId": r.input.StrategyID,
			}),
			CreatedAt: now.UnixNano(),
		},
		{
			ID:   domain.NewEventID(now, "graph_initialized"),
			Type: string(domain.EventGraphInitialized),
			Payload: domain.MustJSON(map[string]any{
				"graphId":   r.graph.ID,
				"projectId": r.input.ProjectID,
				"sessionId": r.input.SessionID,
				"title":     r.graph.Title,
				"status":    string(r.graph.Status),
				"nodeCount": len(r.graph.Nodes),
			}),
			CreatedAt: now.UnixNano(),
		},
	}); err != nil {
		return err
	}
	if err := r.tick(ctx); err != nil {
		return err
	}
	return r.saveSnapshot(ctx)
}

func (r *SessionRuntime) Run(ctx context.Context) error {
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case cmd := <-r.commands:
			if err := r.handleCommand(ctx, cmd); err != nil {
				return err
			}
		}
	}
}

func (r *SessionRuntime) Send(ctx context.Context, cmd Command) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	case r.commands <- cmd:
		return nil
	}
}

func (r *SessionRuntime) handleCommand(ctx context.Context, cmd Command) error {
	if r.graph == nil {
		return fmt.Errorf("graph is not initialized")
	}

	now := r.clock.Now()

	switch typed := cmd.(type) {
	case ResumeCommand:
		if r.sessionRepo != nil {
			if err := r.sessionRepo.UpdateStatus(ctx, r.input.SessionID, domain.SessionRunning); err != nil {
				return err
			}
		}
		r.graph.Status = domain.GraphRunning
		r.graph.UpdatedAt = now
		if err := r.appendEvents(ctx, []EventRecord{{
			ID:   domain.NewEventID(now, "session_resumed"),
			Type: string(domain.EventCheckpointResumed),
			Payload: domain.MustJSON(map[string]any{
				"sessionId": r.input.SessionID,
			}),
			CreatedAt: now.UnixNano(),
		}}); err != nil {
			return err
		}
		if err := r.tick(ctx); err != nil {
			return err
		}
		return r.saveSnapshot(ctx)

	case RetryNodeCommand:
		if node, ok := r.graph.Nodes[typed.NodeID]; ok {
			node.Status = domain.NodeReady
			node.UpdatedAt = now
			node.LastError = ""
			node.LastErrorKind = ""
		}
		if r.sessionRepo != nil {
			if err := r.sessionRepo.UpdateStatus(ctx, r.input.SessionID, domain.SessionRunning); err != nil {
				return err
			}
		}
		r.graph.Status = domain.GraphRunning
		r.graph.CompletedAt = nil
		r.graph.UpdatedAt = now
		if err := r.appendEvents(ctx, []EventRecord{{
			ID:   domain.NewEventID(now, "node_retry"),
			Type: string(domain.EventNodeRetryScheduled),
			Payload: domain.MustJSON(map[string]any{
				"sessionId": r.input.SessionID,
				"nodeId":    typed.NodeID,
			}),
			CreatedAt: now.UnixNano(),
		}}); err != nil {
			return err
		}
		if err := r.tick(ctx); err != nil {
			return err
		}
		return r.saveSnapshot(ctx)

	case ApproveCheckpointCommand:
		if node, ok := r.graph.Nodes[typed.NodeID]; ok {
			node.Status = domain.NodeDone
			node.UpdatedAt = now
		}
		if r.sessionRepo != nil {
			if err := r.sessionRepo.UpdateStatus(ctx, r.input.SessionID, domain.SessionRunning); err != nil {
				return err
			}
		}
		r.graph.Status = domain.GraphRunning
		r.graph.UpdatedAt = now
		if err := r.appendEvents(ctx, []EventRecord{{
			ID:   domain.NewEventID(now, "checkpoint_approved"),
			Type: string(domain.EventCheckpointApproved),
			Payload: domain.MustJSON(map[string]any{
				"sessionId": r.input.SessionID,
				"nodeId":    typed.NodeID,
			}),
			CreatedAt: now.UnixNano(),
		}}); err != nil {
			return err
		}
		if err := r.tick(ctx); err != nil {
			return err
		}
		return r.saveSnapshot(ctx)
	default:
		return nil
	}
}

func (r *SessionRuntime) tick(ctx context.Context) error {
	if r.graph == nil {
		return nil
	}

	for {
		now := r.clock.Now()
		domain.UpdatePendingNodes(r.graph, now)

		ready := domain.ReadyNodes(r.graph)
		if len(ready) == 0 {
			if domain.IsGraphDone(r.graph) {
				r.graph.Status = domain.GraphDone
				r.graph.UpdatedAt = now
				r.graph.CompletedAt = &now
				if r.sessionRepo != nil {
					if err := r.sessionRepo.UpdateStatus(ctx, r.input.SessionID, domain.SessionDone); err != nil {
						return err
					}
				}
				if err := r.saveSnapshot(ctx); err != nil {
					return err
				}
				return r.appendEvents(ctx, []EventRecord{{
					ID:   domain.NewEventID(now, "graph_completed"),
					Type: string(domain.EventGraphCompleted),
					Payload: domain.MustJSON(map[string]any{
						"sessionId": r.input.SessionID,
						"graphId":   r.graph.ID,
					}),
					CreatedAt: now.UnixNano(),
				}})
			}
			return nil
		}

		node := ready[0]
		if node.Type == domain.NodeCheckpoint {
			node.Status = domain.NodeRunning
			node.UpdatedAt = now
			r.graph.Status = domain.GraphPaused
			r.graph.UpdatedAt = now
			if r.sessionRepo != nil {
				if err := r.sessionRepo.UpdateStatus(ctx, r.input.SessionID, domain.SessionPaused); err != nil {
					return err
				}
			}
			if err := r.saveSnapshot(ctx); err != nil {
				return err
			}
			return r.appendEvents(ctx, []EventRecord{{
				ID:   domain.NewEventID(now, "graph_paused"),
				Type: string(domain.EventGraphPaused),
				Payload: domain.MustJSON(map[string]any{
					"sessionId": r.input.SessionID,
					"nodeId":    node.ID,
				}),
				CreatedAt: now.UnixNano(),
			}})
		}

		node.Status = domain.NodeRunning
		node.UpdatedAt = now
		if err := r.saveSnapshot(ctx); err != nil {
			return err
		}
		if err := r.appendEvents(ctx, []EventRecord{{
			ID:   domain.NewEventID(now, "node_started"),
			Type: string(domain.EventNodeStarted),
			Payload: domain.MustJSON(map[string]any{
				"sessionId": r.input.SessionID,
				"nodeId":    node.ID,
			}),
			CreatedAt: now.UnixNano(),
		}}); err != nil {
			return err
		}

		result, err := r.executor.ExecuteNode(ctx, r.graph, node)
		if err != nil {
			node.Status = domain.NodeFailed
			node.UpdatedAt = r.clock.Now()
			node.LastError = err.Error()
			node.LastErrorKind = domain.ErrorFatal
			r.graph.Status = domain.GraphFailed
			r.graph.UpdatedAt = node.UpdatedAt
			if r.sessionRepo != nil {
				if setErr := r.sessionRepo.UpdateStatus(ctx, r.input.SessionID, domain.SessionFailed); setErr != nil {
					return setErr
				}
			}
			if err := r.saveSnapshot(ctx); err != nil {
				return err
			}
			return r.appendEvents(ctx, []EventRecord{{
				ID:   domain.NewEventID(node.UpdatedAt, "node_failed"),
				Type: string(domain.EventNodeFailed),
				Payload: domain.MustJSON(map[string]any{
					"sessionId": r.input.SessionID,
					"nodeId":    node.ID,
					"error":     err.Error(),
				}),
				CreatedAt: node.UpdatedAt.UnixNano(),
			}, {
				ID:   domain.NewEventID(node.UpdatedAt, "graph_failed"),
				Type: string(domain.EventGraphFailed),
				Payload: domain.MustJSON(map[string]any{
					"sessionId": r.input.SessionID,
					"graphId":   r.graph.ID,
					"error":     err.Error(),
				}),
				CreatedAt: node.UpdatedAt.UnixNano(),
			}})
		}

		node.Status = domain.NodeVerifying
		node.UpdatedAt = r.clock.Now()
		node.Evidence = result.Evidence
		r.graph.UpdatedAt = node.UpdatedAt
		if err := r.appendEvents(ctx, []EventRecord{{
			ID:   domain.NewEventID(node.UpdatedAt, "node_verifying"),
			Type: string(domain.EventNodeVerifying),
			Payload: domain.MustJSON(map[string]any{
				"sessionId": r.input.SessionID,
				"nodeId":    node.ID,
			}),
			CreatedAt: node.UpdatedAt.UnixNano(),
		}}); err != nil {
			return err
		}

		outcome, err := r.verifyNode(ctx, node)
		if err != nil {
			return err
		}
		if node.Evidence == nil {
			node.Evidence = &domain.Evidence{}
		}
		node.Evidence.Verifications = append(node.Evidence.Verifications, outcome.Records...)

		if !outcome.Passed {
			if node.RetryCount < node.MaxRetries {
				node.RetryCount++
				node.Status = domain.NodeReady
				node.LastError = outcome.FailureSummary
				node.LastErrorKind = domain.ErrorVerify
				node.UpdatedAt = r.clock.Now()
				r.graph.UpdatedAt = node.UpdatedAt
				if err := r.saveSnapshot(ctx); err != nil {
					return err
				}
				if err := r.appendEvents(ctx, []EventRecord{{
					ID:   domain.NewEventID(node.UpdatedAt, "node_retry"),
					Type: string(domain.EventNodeRetryScheduled),
					Payload: domain.MustJSON(map[string]any{
						"sessionId":  r.input.SessionID,
						"nodeId":     node.ID,
						"retryCount": node.RetryCount,
						"error":      outcome.FailureSummary,
					}),
					CreatedAt: node.UpdatedAt.UnixNano(),
				}}); err != nil {
					return err
				}
				continue
			}

			node.Status = domain.NodeFailed
			node.LastError = outcome.FailureSummary
			node.LastErrorKind = domain.ErrorVerify
			node.UpdatedAt = r.clock.Now()
			r.graph.Status = domain.GraphFailed
			r.graph.UpdatedAt = node.UpdatedAt
			if r.sessionRepo != nil {
				if setErr := r.sessionRepo.UpdateStatus(ctx, r.input.SessionID, domain.SessionFailed); setErr != nil {
					return setErr
				}
			}
			if err := r.saveSnapshot(ctx); err != nil {
				return err
			}
			return r.appendEvents(ctx, []EventRecord{{
				ID:   domain.NewEventID(node.UpdatedAt, "node_failed"),
				Type: string(domain.EventNodeFailed),
				Payload: domain.MustJSON(map[string]any{
					"sessionId": r.input.SessionID,
					"nodeId":    node.ID,
					"error":     outcome.FailureSummary,
				}),
				CreatedAt: node.UpdatedAt.UnixNano(),
			}, {
				ID:   domain.NewEventID(node.UpdatedAt, "graph_failed"),
				Type: string(domain.EventGraphFailed),
				Payload: domain.MustJSON(map[string]any{
					"sessionId": r.input.SessionID,
					"graphId":   r.graph.ID,
					"error":     outcome.FailureSummary,
				}),
				CreatedAt: node.UpdatedAt.UnixNano(),
			}})
		}

		node.Status = domain.NodeDone
		node.UpdatedAt = r.clock.Now()
		r.graph.UpdatedAt = node.UpdatedAt
		if err := r.appendEvents(ctx, []EventRecord{{
			ID:   domain.NewEventID(node.UpdatedAt, "node_completed"),
			Type: string(domain.EventNodeCompleted),
			Payload: domain.MustJSON(map[string]any{
				"sessionId": r.input.SessionID,
				"nodeId":    node.ID,
			}),
			CreatedAt: node.UpdatedAt.UnixNano(),
		}}); err != nil {
			return err
		}
	}
}

func (r *SessionRuntime) verifyNode(ctx context.Context, node *domain.Node) (*VerificationOutcome, error) {
	if r.verifier == nil {
		return &VerificationOutcome{Passed: true, Records: []domain.VerificationRecord{}}, nil
	}
	return r.verifier.VerifyNode(ctx, r.graph, node)
}

func (r *SessionRuntime) appendEvents(ctx context.Context, events []EventRecord) error {
	if r.events == nil {
		return nil
	}
	rev, err := r.events.LatestRevision(ctx, r.input.SessionID)
	if err != nil {
		return err
	}
	return r.events.Append(ctx, r.input.SessionID, rev, events)
}

func (r *SessionRuntime) saveSnapshot(ctx context.Context) error {
	if r.graphRepo == nil || r.graph == nil {
		return nil
	}
	return r.graphRepo.SaveSnapshot(ctx, r.input.SessionID, r.graph)
}
