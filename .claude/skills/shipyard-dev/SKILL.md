---
name: shipyard-dev
description: Use when starting any task in the Shipyard project. Load this first before touching any file.
---

# Shipyard — Project Gateway

## What This Project Is

Observable AI development IDE. User inputs spec → AI decomposes into DAG → executes in parallel → verifies each result → streams status to UI.

**Not** black-box automation (Devin). **Not** interactive assistant (Cursor).
Transparent, human-directed AI development.

## Current State

```
v0.3 — CLI working end-to-end
v0.4 — checkpoint + verification hardening (next)
v0.5 — WebSocket + REST API
v1.0 — three-panel IDE
```

## First Principle

> **When uncertain, choose the option that gives the human more control.**

- Transparency over elegance — show failures, not just final results
- Confirm over assume — ambiguous spec → insert checkpoint, don't guess
- Progressive over complete — smallest unit reliable first, then expand

## Architecture Rules (Never Violate)

1. `src/` is pure Node.js — zero UI dependencies
2. Node execution is atomic — complete or rollback, never partial
3. Evidence is append-only — never modify execution records
4. No node marked `done` without passing verification
5. Checkpoint nodes pause for human confirmation on key decisions

## Core Files

```
src/graph.ts      All types + execution graph  ← read this first
src/shipyard.ts   Main scheduler, run() entry
src/llm.ts        Agent loop + tool use
src/verify.ts     Spec-derived verification
src/prompts.ts    All LLM system prompts
src/checkpoint.ts Checkpoint save/load/resume
src/config.ts     Config, reads env vars
```

## AI Coding Rules

| Rule | Why |
|------|-----|
| One responsibility per file | Changes don't cascade |
| All types in graph.ts | Never guess a type |
| Flat directory structure | No deep navigation |
| No implicit any | TypeScript strict |
| Pure functions separate from side effects | Safe to change logic |

## Load Sub-Skills When Needed

| Working on | Load skill |
|------------|------------|
| `src/` engine code | `shipyard-engine` |
| `server/` API layer | `shipyard-api` |
| `client/` frontend | `shipyard-ui` |
