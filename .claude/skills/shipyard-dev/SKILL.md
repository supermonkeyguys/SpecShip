---
name: shipyard-dev
description: Use when starting any task in the Shipyard project. Load this first before touching any file.
---

# Shipyard — Project Gateway

## What This Project Is

Observable AI development IDE. User inputs a spec → the system decomposes it into a DAG → executes nodes in parallel → verifies results → streams state to the UI.

**Not** black-box automation (Devin). **Not** a chat-first coding assistant (Cursor).
Shipyard is a transparent, human-directed execution workspace.

## First Principle

> **When uncertain, choose the option that gives the human more control.**

- Transparency over elegance — show failures, pauses, and evidence
- Confirm over assume — ambiguous tasks should clarify or checkpoint
- Progressive over complete — make the smallest reliable step first
- Deterministic routing before LLM interpretation for critical control flow

## Current Repository Shape

```txt
apps/
  cli/                 CLI entry
  server/              Express API + SSE + session/project routes
  web/                 React frontend
packages/
  core/                execution graph, orchestrator, AI layer, verification, persistence
  shared/              cross-boundary shared types
  orchestrator-temporal/ optional Temporal orchestration path
```

## Architecture Rules (Never Violate)

1. `packages/core` contains execution/orchestration logic, not `apps/server`
2. Cross-boundary shared types live in `packages/shared/src/types.ts`
3. `apps/server/src/types.ts` and `apps/web/src/types.ts` are re-export shims, not the source of truth
4. No node may be marked `done` before verification passes
5. Execution evidence is append-only; do not silently rewrite execution history
6. Checkpoint nodes are a product/control-flow feature, not a UI-only concept
7. Chat is an input surface; routing decisions should remain deterministic-first where possible

## Read These Files First

### Core engine

```txt
packages/core/src/graph/graph.ts
packages/core/src/orchestrator/shipyard.ts
packages/core/src/orchestrator/planner.ts
packages/core/src/ai/llm.ts
packages/core/src/ai/prompts.ts
packages/core/src/verification/verify.ts
packages/core/src/persistence/checkpoint.ts
packages/core/src/persistence/project.ts
```

### Server layer

```txt
apps/server/src/index.ts
apps/server/src/routes/*
apps/server/src/sse.ts
apps/server/src/sse-projection.ts
apps/server/src/ai/policy.ts
apps/server/src/project.ts
```

### Web layer

```txt
apps/web/src/App.tsx
apps/web/src/domains/execution/*
apps/web/src/domains/workspace/*
apps/web/src/features/*
apps/web/src/shared/api/*
apps/web/src/hooks/useSSE.ts
```

## Working Model

- `packages/core` owns graph modeling, orchestration, retries, checkpoints, verification
- `apps/server` adapts core to HTTP/SSE/session/project APIs
- `apps/web` renders session-aware state and sends user intents to the server
- `packages/shared` defines the API/SSE/shared DTO contract across server and web

## AI Coding Rules

| Rule | Why |
|------|-----|
| Prefer editing the true implementation, not re-export shims | Avoid patching the wrong layer |
| Keep side effects at boundaries | Safer reasoning and testing |
| Use shared types instead of redefining contracts | Prevent server/web drift |
| Respect session-aware state | Shipyard is session-first, not chat-first |
| Favor deterministic control flow for run/resume/clarify/retry | Product consistency |

## Load Sub-Skills When Needed

| Working on | Load skill |
|------------|------------|
| `packages/core/**` engine/orchestrator/verification | `shipyard-engine` |
| `apps/server/**` API/SSE/session layer | `shipyard-api` |
| `apps/web/**` frontend/store/features | `shipyard-ui` |

## Important Notes

- Some `apps/server/src/*` files re-export from `packages/core`; if behavior is wrong, fix core first
- Root `pnpm typecheck` does not fully represent web quality by itself; also use web lint/build when touching UI
- When product behavior is ambiguous, prefer `PRODUCT_PRINCIPLES.md` over local convenience
