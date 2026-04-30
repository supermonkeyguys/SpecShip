---
name: shipyard-engine
description: Use when working on packages/core engine code — graph, orchestrator, ai, verification, persistence, checkpoint flow.
---

# Shipyard Engine

## Source of Truth

The engine lives in `packages/core/src/**`, mainly:

```txt
packages/core/src/
  graph/           graph model, stats, status mapping
  orchestrator/    planner, scheduler loop, node execution, review, checkpoint runtime
  ai/              LLM runner, prompts, config
  verification/    compile / behavior / lint verification
  persistence/     checkpoint + project/session persistence helpers
  context/         repo/context helpers
  config.ts
```

## Data Flow

```txt
user spec
  → planner
  → ExecutionGraph (DAG of GraphNodes)
  → orchestrator run loop
  → per node: execute → verify → transition status
  → checkpoint persistence + session graph persistence
  → server/web consume projections and serialized state
```

## Node Status Machine

Current graph node statuses include:

```txt
pending → ready → running → verifying → done
                         ↘ failed → ready   (retry path)
blocked ↔ pending
skipped (terminal)
```

### Rules

- Never transition to `done` before verification passes
- Retry is represented by `failed -> ready`, not a separate pseudo-status
- `blocked` means upstream dependency state prevents execution
- Any status-machine change must preserve graph stats and dependency semantics

## Files to Inspect Before Editing

- `packages/core/src/graph/graph.ts`
- `packages/core/src/graph/state.ts`
- `packages/core/src/orchestrator/shipyard.ts`
- `packages/core/src/orchestrator/node-executor.ts`
- `packages/core/src/orchestrator/post-node-handler.ts`
- `packages/core/src/orchestrator/checkpoint-runtime.ts`
- `packages/core/src/orchestrator/runtime-types.ts`
- `packages/core/src/verification/verify.ts`

## Execution Rules

- Graph/evidence updates must remain serializable to checkpoint files
- Evidence must capture tool calls, written files, verification records, and timing
- Checkpoint persistence must be atomic and resumable
- Planner/output compatibility shims should be explicit, not hidden inside unrelated logic
- If server imports a core symbol through a shim, change the underlying core implementation unless the problem is truly adapter-specific

## Shared Contracts to Respect

Engine-internal `GraphNode` / `ExecutionGraph` are richer than UI-facing `NodeStatus`.
Do not couple engine types to frontend DTOs.

UI/server-facing DTOs come from `packages/shared/src/types.ts` and are projections of engine state.

## Known Sharp Edges

- Behavior verification can still be fragile for complex exports/module shapes
- Planner/output normalization needs caution around dependency ids vs file paths
- Verify changes affect retry semantics, summaries, and SSE projections downstream

## Local Run/Validation

Typical entrypoints:

```bash
pnpm start
pnpm server
pnpm test
pnpm typecheck
```

When touching UI-observable engine behavior, also validate the server/web path that consumes the projections.

## Checklist for Engine Changes

- [ ] Read `graph.ts` and `runtime-types.ts` first
- [ ] Confirm state transitions still obey the status machine
- [ ] Preserve evidence completeness
- [ ] Preserve checkpoint save/load behavior
- [ ] Check whether server/UI projections need updating after type/status changes
- [ ] Prefer changing `packages/core` instead of re-export wrappers
