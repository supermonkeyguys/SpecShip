---
name: shipyard-api
description: Use when working on apps/server API layer — Express routes, SSE, session/project APIs, preview, deterministic policy entrypoints.
---

# Shipyard API Layer

## Source of Truth

The API layer lives in `apps/server/src/**`:

```txt
apps/server/src/
  index.ts
  routes/
    run.ts
    stream.ts
    node.ts
    files.ts
    chat.ts
    clarify.ts
    resume.ts
    projects.ts
    preview.ts
  sse.ts
  sse-projection.ts
  ai/policy.ts
  project.ts
  state.ts
  preview-manager.ts
  types.ts   (re-export shim)
```

## Layer Boundaries

- `apps/server` owns HTTP routing, SSE broadcasting/projection, session/project file APIs, preview lifecycle, and deterministic routing/policy adapters
- `packages/core` owns graph/orchestrator/verification behavior
- `packages/shared/src/types.ts` owns server↔web shared DTOs
- `apps/server/src/types.ts` is a convenience re-export, not the canonical type definition file

## Current API Surface

Important endpoints include:

```txt
POST /api/run
GET  /api/stream
POST /api/node/:id/retry
GET  /api/status
POST /api/resume
POST /api/chat
POST /api/clarify
GET  /api/projects
GET  /api/projects/:pid/sessions/:sid/files
GET  /api/projects/:pid/sessions/:sid/file
GET  /api/projects/:pid/sessions/:sid/graph
GET  /api/projects/:pid/sessions/:sid/preview
POST /api/projects/:pid/sessions/:sid/preview/live/start
POST /api/projects/:pid/sessions/:sid/preview/live/stop
PATCH /api/projects/:pid/sessions/:sid
DELETE /api/projects/:pid/sessions/:sid
DELETE /api/projects/:pid
```

## SSE Contract

Shared SSE contract comes from `packages/shared/src/types.ts`.
Current event types include:

```ts
type SSEEventType = "node_update" | "graph_done" | "graph_failed" | "log";
```

`SSEEvent` may carry:

- `projectId`
- `sessionId`
- `payload` as `NodeStatus | GraphSummary | string`

Current `NodeStatus.status` values include:

```txt
pending | ready | running | verifying | done | failed | blocked | skipped
```

Do not reintroduce older simplified status subsets in routes or SSE adapters.

## Deterministic-First Policy

Files like `apps/server/src/routes/chat.ts`, `apps/server/src/routes/clarify.ts`, and `apps/server/src/ai/policy.ts` must follow product rules:

- critical routing should be deterministic-first, LLM-second
- use explicit current session/current nodes/current spec context
- avoid hidden global-state contamination of new run / resume / clarify decisions

## Implementation Rules

- Route files should stay thin; move reusable logic into focused helpers where needed
- If behavior belongs to orchestration, push it into `packages/core`
- Keep SSE manager stateless except for connection/event cache concerns
- Projection adapters must preserve session/project identity on emitted events
- Use shared request/response types instead of inline duplicates

## Checklist for API Changes

- [ ] Is this truly an API concern, not core orchestrator logic?
- [ ] Are shared contracts defined in `packages/shared/src/types.ts`?
- [ ] Do SSE events include correct `projectId/sessionId` context?
- [ ] Does the route preserve deterministic-first product behavior?
- [ ] Are session/project filesystem reads scoped safely?
- [ ] If changing node projections, does web still understand the payload?
