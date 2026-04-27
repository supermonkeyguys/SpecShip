---
name: shipyard-ui
description: Use when working on client/ frontend — React, Zustand, React Flow, layout, SSE connection.
---

# Shipyard UI

## Tech Stack

```
React + TypeScript
Vite
Zustand        state management
React Flow     DAG canvas (read-only + click for detail)
TailwindCSS    styling
```

## Directory Structure

```
client/
├── src/
│   ├── App.tsx
│   ├── store/
│   │   └── graph.ts      Zustand store — single source of truth
│   ├── components/
│   │   ├── Canvas.tsx     React Flow DAG canvas
│   │   ├── FileTree.tsx   Left panel
│   │   └── Chat.tsx       Right panel (log tab + chat tab)
│   └── hooks/
│       └── useSSE.ts      SSE connection + store updates
└── vite.config.ts
```

## Three-Panel Layout

```
┌──────────────┬──────────────────────────┬──────────────┐
│  FileTree    │        Canvas            │    Chat      │
│  (left)      │   React Flow DAG         │  log | chat  │
│              │   node cards             │              │
└──────────────┴──────────────────────────┴──────────────┘
```

## Zustand Store Shape

```typescript
// store/graph.ts
interface GraphStore {
  nodes: Record<string, NodeStatus>
  logs: string[]
  status: "idle" | "running" | "done" | "failed"
  updateNode: (node: NodeStatus) => void
  appendLog: (msg: string) => void
}
```

## SSE → Store Pattern

```typescript
// hooks/useSSE.ts
useEffect(() => {
  const es = new EventSource("/stream")
  es.onmessage = (e) => {
    const event: SSEEvent = JSON.parse(e.data)
    if (event.type === "node_update") updateNode(event.payload)
    if (event.type === "log") appendLog(event.payload)
  }
  return () => es.close()
}, [])
```

## Node Card Colors

```
pending  → gray
running  → blue (pulse animation)
done     → green
failed   → red
blocked  → gray/dim
```

## Checklist for UI Changes

- [ ] All server types imported from `server/types.ts` — never redefined in client
- [ ] Store is the only place that holds node state — components read from store only
- [ ] Canvas is read-only — no drag-to-edit DAG structure
- [ ] Click on node → show detail panel (evidence, files, verifications)
- [ ] Chat panel has two tabs: Log (auto-scroll) and Chat (AI conversation)
