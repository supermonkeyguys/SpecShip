# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## REQUIRED: Load project skill before any work

Before reading any file, writing any code, or answering any question about this project:

```
Use the Skill tool to load: shipyard-dev
```

---

## Commands

```bash
# Full test suite (15 core regression tests, no LLM calls)
pnpm test

# Temporal orchestrator tests only
node --require tsx/cjs --test packages/orchestrator-temporal/test/spec-run.smoke.test.ts

# TypeScript check (all packages)
pnpm typecheck

# Frontend
pnpm web:dev          # Vite dev server
pnpm web:build        # Production build + tsc

# Backend
pnpm server:dev       # Express dev server (tsx watch)

# Run both together
pnpm dev

# Temporal (requires temporal CLI: brew install temporal)
pnpm temporal:server  # Start Temporal dev server
pnpm temporal:worker  # Start Temporal worker (in separate terminal)
pnpm temporal:all     # Both together via concurrently

# Legacy CLI
pnpm cli:dev
```

**Compile-check a single package:**
```bash
cd packages/core && npx tsc --noEmit
cd packages/orchestrator-temporal && npx tsc --noEmit
```

**Run a single test file:**
```bash
node --require tsx/cjs --test test/regression/retry.test.ts
```

---

## Product Principles

For any work involving chat routing, clarification, session semantics, or resume behavior, read and follow:

- `PRODUCT_PRINCIPLES.md`

This document is the repo-level source of truth for product first principles. If local implementation convenience conflicts with it, prefer the product principles.

---

## Architecture

This is a **pnpm monorepo** (`apps/`, `packages/`) with Turbo. The product is an observable AI dev IDE: user inputs a spec → AI decomposes it into a DAG → executes nodes in parallel → verifies each result → streams status to UI.

### Package layout

```
packages/core/src/          Pure Node.js engine — zero UI deps
packages/orchestrator-temporal/src/   Temporal workflow layer
packages/shared/src/        Types shared across server ↔ client

apps/server/src/            Express API + SSE
apps/web/src/               React + Vite frontend
apps/cli/src/               CLI entry point
test/regression/            Integration tests (no LLM, injected mocks)
```

### Core engine (`packages/core/src/`)

The engine is the most important layer. Data flows:

```
spec → buildGraph() [Planner LLM] → ExecutionGraph (DAG)
     → run() scheduler loop
       → executeNode() [Implementer LLM, tools: write_file/read_file/run_command/search_files/list_dir]
       → verifyNode() [compile → behavior → *.test.ts]
       → runCodeReview() [Reviewer LLM]
       → status: done | retry | failed
```

Key files (read in this order when uncertain):
- `graph.ts` — all types: `GraphNode`, `ExecutionGraph`, `NodeStatus`, `Evidence`, etc.
- `shipyard.ts` — `buildGraph()`, `executeNode()`, `run()` scheduler, `clarifySpec()`
- `llm.ts` — LLM client + tool execution (`write_file`, `read_file`, `run_command`, `search_files`, `list_dir`)
- `verify.ts` — `verifyNode()`: compile check → LLM-extracted behavior tests → `*.test.ts` execution
- `prompts.ts` — all system prompts (Planner, Implementer, Reviewer, Clarifier, Spec Extractor)
- `checkpoint.ts` — atomic checkpoint write (`.tmp` + rename); `prepareGraphForResume()`
- `repo.ts` — `extractRepoContext()`: builds symbol-level API map (export signatures) to inject into Planner
- `config.ts` — `ShipyardConfig`; reads `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `MODEL_*` env vars

**Dependency injection for testing:** `run()` and `buildGraph()` accept `agentRunner` and `nodeVerifier` overrides — never mock the module, always inject via these parameters.

### Temporal orchestrator (`packages/orchestrator-temporal/`)

Alternative execution backend activated via `ORCHESTRATOR_MODE=temporal`.

- `workflows/spec-run.workflow.ts` — `SpecRunWorkflow`: DAG scheduling, no I/O (Workflow rule)
- `activities/spec-run.activities.ts` — actual LLM calls, file I/O, `notifyNodeUpdate`
- `client/run-workflow.ts` — public API the server calls; also exports `signalRetryNode`, `signalSkipNode`, `querySpecRunSummary`
- `worker/worker.ts` — worker entry point

Signals: `retryNode`, `skipNode`, `cancelRun`, `resumeRun`  
Queries: `getRunSummary`

### Server (`apps/server/src/`)

Express + SSE. Routes:
- `POST /api/run` — starts a run (legacy or Temporal); responds immediately, runs async
- `GET /api/status`, `POST /api/resume` — resume a session
- `GET /api/stream` — SSE stream (all events since connection)
- `POST /api/clarify` — pre-run spec clarification
- `POST /api/chat` — intent detection (retry_node / new_run / resume / status)
- `POST /api/node/:id/retry` — retry a failed node
- `GET /api/projects`, `GET /api/projects/:id/sessions/:sid/graph` — project/session data

`ORCHESTRATOR_MODE=legacy` (default) calls core `run()` directly. `ORCHESTRATOR_MODE=temporal` starts a Temporal workflow.

`SSEManager` (`sse.ts`) holds all events in memory for replay on reconnect. `sse-projection.ts` bridges Temporal file-based events to SSE via `fs.watch`.

All cross-boundary types live in `packages/shared/src/types.ts` — never duplicate them.

### Frontend (`apps/web/src/`)

React 19 + Zustand 5 + Vite + Tailwind 4 + Radix UI primitives.

**State architecture — two domain stores:**

`domains/execution/store.ts` — session-aware execution state:
- `sessions: Record<sessionId, SessionExecutionState>` — graph nodes, logs, runStatus, chatMessages per session
- `activeSessionId` — what the user is viewing
- `liveSessionId` — which session is receiving realtime SSE
- `replaceSessionSnapshot()` — called on session switch (historical load)
- `applyRealtimeEvent()` — called by `useSSE` for live events
- `appendChatMessage()` / `setChatMessages()` — chat history per session

`domains/workspace/store.ts` — UI navigation state:
- `activeSession`, `selectedFile`, `resumeInfo`

**Feature layer** (`features/`):
- `session/useSession.ts` — orchestrates session switching, resume, snapshot loading
- `session/ProjectPanel.tsx` — left sidebar
- `canvas/Canvas.tsx` — React Flow graph
- `chat/Chat.tsx` — tabs (Chat / Log); `ChatPanel` uses `createChatRunController` for intent dispatch
- `files/useFilePreview.ts` — file preview with abort controller race protection

**Shared API clients** (`shared/api/`): `runClient`, `chatClient`, `clarifyClient`, `nodeClient`, `projectClient`, `fileClient` — components never call `fetch` directly.

**SSE flow:** `useSSE` hook → `applyRealtimeEvent(event, event.sessionId)` → execution store updates → Canvas/Log re-render. Events carry explicit `projectId`/`sessionId` for multi-session routing.

---

## Non-Negotiable Rules

1. `packages/core/` has **zero UI dependencies**
2. Node execution is **atomic** — complete or rollback, never partial
3. Evidence is **append-only** — never modify execution records
4. No node marked `done` without passing verification
5. Temporal Workflow code does **no I/O** — all side effects in Activities
6. Atomic checkpoint writes: write to `.tmp` first, then rename
7. All cross-boundary types in `packages/shared/src/types.ts` — never duplicate
8. Frontend: never return new `{}` / `[]` from Zustand selectors — use stable module-level constants to avoid React 19 infinite re-render (`Maximum update depth exceeded`)

---

## Environment Variables

```bash
OPENAI_BASE_URL=https://...     # LLM proxy base URL
OPENAI_API_KEY=sk-...           # API key
MODEL_PLANNING=gpt-5.1          # Planner + Reviewer model
MODEL_IMPLEMENTATION=gpt-5.1    # Implementer model
FORCE_CHAT_COMPLETIONS=1        # Skip /responses endpoint, use /chat/completions directly
ORCHESTRATOR_MODE=temporal      # Use Temporal instead of legacy in-process execution
TEMPORAL_LIVE_TEST=1            # Enable live Temporal server test in phase4-live.test.ts
```
