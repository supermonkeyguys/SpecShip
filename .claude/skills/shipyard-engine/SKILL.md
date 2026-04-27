---
name: shipyard-engine
description: Use when working on src/ engine code — graph, scheduler, llm, verify, checkpoint, prompts.
---

# Shipyard Engine

## Data Flow

```
user spec
  → Planner LLM  → ExecutionGraph (DAG of GraphNodes)
  → Scheduler    → dispatch by dependency order (parallel where possible)
  → per node:    → Implementer LLM (agent loop + tool_use)
                 → verify.ts (compile → behavior)
                 → status: done | failed | retrying
  → graph.json   → consumed by UI / API
```

## Node Status Machine

```
pending → running → verifying → done
                             ↘ failed → retrying → running  (max 2 retries)
                                                 ↘ failed (terminal)
```

**Rule:** never transition a node to `done` before verifying passes.
**Rule:** `running.delete(nodeId)` must happen AFTER `verifyNode()` completes — not before.

## Key Types (graph.ts)

```typescript
GraphNode.status:   "pending" | "running" | "done" | "failed" | "blocked"
GraphNode.evidence: { toolCalls, filesWritten, verifications, durationMs }
ExecutionGraph.nodes: Map<string, GraphNode>
ExecutionGraph.originalSpec: string
```

## Known Issues (Check Before Fixing)

- Behavior verification relies on function name matching — fragile for complex exports
- Planner occasionally writes `dependsOn` as file paths instead of node IDs (compatibility shim exists in scheduler)
- Generated `*.test.ts` files are not executed yet

## Next Priority

```
1. Phase 1.1 — Checkpoint persistence (atomic write via tmp+rename, resume from any node)
2. Phase 1.3 — Verification hardening (run *.test.ts, lint, hard vs soft failure distinction)
```

## Running Locally

```bash
OPENAI_BASE_URL=https://aicodelink.top/v1 \
OPENAI_API_KEY=sk-xxx \
npx ts-node src/index.ts "your spec"

# Resume after interrupt:
npx ts-node src/index.ts --resume
```

## Checklist for Engine Changes

- [ ] Read `graph.ts` types before any change
- [ ] Check `PLAN.md` phase ordering — don't skip phases
- [ ] Verify node status machine still holds after status logic changes
- [ ] Evidence must be recorded for every tool call and file write
- [ ] Atomic write for any checkpoint: write to `.tmp` first, then rename
