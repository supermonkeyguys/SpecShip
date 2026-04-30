---
name: shipyard-ui
description: Use when working on apps/web frontend — React, session-aware Zustand stores, React Flow canvas, chat, preview, and SSE-driven state updates.
---

# Shipyard UI

## Source of Truth

The frontend lives in `apps/web/src/**` and is organized by domains + features:

```txt
apps/web/src/
  App.tsx
  domains/
    execution/
    workspace/
  features/
    canvas/
    chat/
    files/
    preview/
    session/
  shared/
    api/
    ui/
  hooks/
    useSSE.ts
  components/ui/
```

## UI Architecture

### App shell

- `App.tsx` composes the three-panel layout
- keep it focused on composition and top-level coordination
- avoid pushing feature logic back into the shell unless it is truly cross-panel orchestration

### Domains

- `domains/execution/*` → session-aware execution state, realtime events, run/chat control helpers
- `domains/workspace/*` → active session, selected file, project tree, preview state, resume info

### Features

- `features/canvas/*` → DAG visualization and node detail
- `features/chat/*` → chat/log UI + clarification card
- `features/files/*` → file preview
- `features/preview/*` → static/live preview panel
- `features/session/*` → project/session navigation + resume flow

## State Rules

- Zustand stores are the source of truth for shared UI state
- Components should derive from store/hook state rather than duplicating server state locally
- Execution state is session-aware; do not assume one global run forever
- Session switches should not leak file selection, preview state, or chat state across sessions accidentally

## Shared Types

Shared API/SSE types originate in `packages/shared/src/types.ts`.
In web code, they are typically imported via `apps/web/src/types.ts`.

Do **not** redefine API DTOs or SSE payloads inside features.

## SSE → Store Pattern

`apps/web/src/hooks/useSSE.ts` connects to `/api/stream` and pushes realtime events into the execution store.

Rules:

- preserve `sessionId` targeting
- preserve `projectId` when available
- keep SSE event handling thin; projection/normalization belongs in store/controller layers

## Canvas Rules

- Canvas is read-only; it visualizes DAG state, it does not edit graph structure
- Node detail can show evidence, files, verifications, errors, retry action
- Layout is computed in `features/canvas/layout.ts`
- Avoid render-time ref misuse or effect-driven state churn

## Chat / Clarification Rules

- Chat is an input surface for run/retry/resume/status interactions
- Clarification cards should appear when the server says clarification is needed
- Do not let local UI shortcuts bypass deterministic-first server policy
- Preserve chat history per session when that history is part of the session UX

## Validation Rules

When touching web code, validate with at least:

```bash
pnpm --filter @shipyard/web lint
pnpm --filter @shipyard/web build
```

Root checks alone are not enough to represent frontend quality.

## Checklist for UI Changes

- [ ] Am I editing the right layer: app shell vs domain vs feature?
- [ ] Are shared contracts imported rather than redefined?
- [ ] Does this preserve session-aware behavior?
- [ ] Does SSE/store logic still target the correct session?
- [ ] Is Canvas still read-only?
- [ ] Have I run web lint and web build?
