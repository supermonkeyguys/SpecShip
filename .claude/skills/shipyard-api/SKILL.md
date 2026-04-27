---
name: shipyard-api
description: Use when working on server/ API layer — Express routes, SSE, REST endpoints.
---

# Shipyard API Layer

## Directory Structure

```
server/
├── index.ts          Express entry point
├── types.ts          Shared types (imported by both server/ and client/)
├── sse.ts            SSE push manager
└── routes/
    ├── run.ts        POST /run
    ├── stream.ts     GET  /stream  (SSE)
    ├── node.ts       POST /node/:id/retry
    └── files.ts      GET  /files
```

**Rule:** engine changes go in `src/`, never in `server/`.
**Rule:** shared frontend/backend types go in `server/types.ts` only.

## API Contracts

```
POST /run
  body:    { spec: string }
  returns: { graphId: string }

GET  /stream
  returns: SSE stream of SSEEvent

POST /node/:id/retry
  returns: { ok: boolean }

GET  /files
  returns: { files: FileEntry[] }
```

## SSE Event Format

```typescript
// defined in server/types.ts
interface SSEEvent {
  type: "node_update" | "graph_done" | "log"
  payload: NodeStatus | string
}

interface NodeStatus {
  id: string
  title: string
  status: "pending" | "running" | "done" | "failed"
  filesWritten: string[]
  error?: string
}
```

## SSE Push Pattern

```typescript
// sse.ts manages all active connections
// call push() after every node status transition in shipyard.ts
sseManager.push({ type: "node_update", payload: nodeStatus })
```

## Checklist for API Changes

- [ ] New types go in `server/types.ts` — never inline in route files
- [ ] Every route has explicit request/response types
- [ ] SSE events must match `SSEEvent` interface exactly
- [ ] Engine (`src/`) is imported by server, never the reverse
