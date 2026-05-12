# Frontend Decoupling Plan

## Status
Draft v0.2 — consolidated on 2026-05-09

## Why this plan exists
The current frontend is functional, but several core features mix:

- rendering
- API orchestration
- store mutation
- session lifecycle management
- cross-feature cleanup side effects

This document proposes a phased, low-risk decoupling plan. It is designed to preserve behavior while making the codebase easier to evolve, test, and reason about.

---

## Scope

This plan focuses on the frontend under `apps/web/src`, especially:

- `App.tsx`
- `features/session/*`
- `features/chat/*`
- `features/canvas/*`
- `domains/workspace/*`
- `domains/execution/*`
- `hooks/useSSE.ts`

---

## Goals

1. Establish a single source of truth for active session selection.
2. Remove duplicated state ownership across hooks and stores.
3. Move API orchestration and side effects out of React view components.
4. Split heavyweight feature components into container/model/action/view layers.
5. Make cross-domain dependencies explicit through selectors and service hooks.
6. Keep migration incremental and low-risk.

## Non-goals

- Rewrite the app from scratch
- Replace Zustand or React Flow
- Change UX behavior during the first pass
- Introduce routing-driven workspace navigation in Phase 1

---

# 1. Current coupling summary

## 1.1 Highest-priority coupling problems

### A. Active session has multiple owners
The current selected session is stored in multiple places:

- `features/session/useSession.ts` local state
- `domains/workspace/store.ts`
- `domains/execution/store.ts` as `activeSessionId`

This creates drift risk and forces multi-write synchronization.

### B. `resumeInfo` also has duplicated ownership
It exists in both:

- `useSession.ts` local state
- `workspace.store.ts`

This is pure synchronization overhead.

### C. Identity and metadata are mixed
`ActiveSession` currently includes:

- `projectId`
- `sessionId`
- `spec`

But `spec` is not identity; it is metadata / label. This causes title/spec to exist in multiple places:

- `workspace.projects[].sessions[].spec`
- `execution.sessions[].title`
- `ActiveSession.spec`

### D. Execution store owns UI selection state
`execution.store.ts` currently stores both:

- execution domain data (`sessions`, `streamStatus`, `liveSessionId`)
- UI selection state (`activeSessionId`)

That makes execution store responsible for something that belongs to workspace selection.

### E. Feature components directly orchestrate API + store patching
Examples:

- `ProjectPanel` calls `deleteSession` / `starSession`, then patches workspace store
- `Chat` calls `runSpec`, writes messages, migrates message state, and wires controller behavior
- `Canvas.NodeDetail` calls `retryNode` / `editNode` directly

### F. `App.tsx` is not just layout; it is a workspace state coordinator
It currently handles:

- preview refresh
- session/panel switching side effects
- file/session mismatch cleanup
- central panel mode orchestration

### G. `workspace/controller.ts` is a mixed abstraction
It currently acts as:

- store selector hook
- polling hook
- data sync hook
- mutation aggregator

This makes it too broad and easy to overuse.

### H. Session identity is implicitly assumed globally unique
Several places use only `sessionId`:

- execution session map
- selected session set
- active selection logic

If session IDs are not globally unique across projects, this is unsafe.

---

## 1.2 Feature-specific coupling notes

### `ProjectPanel`
Currently mixes:

- view rendering
- session flattening / derived row state
- selection mode logic
- delete/star API calls
- store patching after mutation
- active session cleanup

### `Chat`
Currently mixes:

- tabs shell
- log panel
- message list rendering
- message persistence / migration
- PRD confirm/discard flow
- retry session flow
- execution store reads/writes
- controller composition

It also mixes two sources of truth:

- `sessionId` prop
- `execution.activeSessionId`

### `Canvas`
Currently mixes:

- execution state subscription
- graph-to-ReactFlow adaptation
- layout logic
- node selection state
- node detail rendering
- retry/edit node actions
- impact analysis state

`NodeDetail` is especially overloaded.

---

# 2. Target architecture

## 2.1 Layering direction

Target layering:

- **UI primitives** — reusable visual-only components
- **Feature views** — render-only or near-render-only components
- **Feature containers / model hooks** — select and adapt state for views
- **Action hooks / services** — orchestrate API calls and cross-store side effects
- **Stores** — own client state and expose selectors for derived reads

## 2.2 Domain boundaries

### Workspace domain should own
- current selected session
- selected file
- central panel mode
- preview info
- session files
- projects / session summaries
- resume banner info
- sidebar selection UI state

### Execution domain should own
- per-session execution graph/log/chat state
- live execution binding
- realtime stream status

### Session service should own
- selecting a session
- activating a started session
- resuming a session
- loading snapshot into execution store
- cross-domain cleanup on session changes and deletion

---

# 3. Target state model

## 3.1 Canonical identity types

Introduce explicit identity types:

```ts
type SessionRef = {
  projectId: string;
  sessionId: string;
}

type SessionKey = `${string}:${string}`
```

Provide helper(s):

```ts
function getSessionKey(ref: SessionRef): SessionKey
function toSessionKey(projectId: string, sessionId: string): SessionKey
```

## 3.2 Single source of truth

### Current selected session
**Owner:** `workspace.activeSessionRef`

Store only identity:

- keep: `projectId`, `sessionId`
- do not store: `spec`, `title`

### Live executing session
**Owner:** `execution.liveSessionRef` or `execution.liveSessionKey`

This is not UI selection, so it stays in execution domain.

### Execution cache per session
**Owner:** `execution.sessionsByKey`

Each session entry owns:

- nodes
- logs
- summary
- runStatus
- revision / parity
- chatMessages

### Resume banner state
**Owner:** `workspace.resumeInfo`

Only one copy should exist.

---

## 3.3 Delete / keep / derive table

| State | Decision |
|---|---|
| `workspace.activeSession` | Keep, but rename conceptually to `activeSessionRef` |
| `useSession.activeSession` | Remove |
| `execution.activeSessionId` | Remove |
| `workspace.resumeInfo` | Keep |
| `useSession.resumeInfo` | Remove |
| `ActiveSession.spec` | Remove from identity model; derive title/spec instead |
| `execution.liveSessionId` | Keep temporarily, but migrate toward `liveSessionKey/ref` |
| `execution.sessions` | Keep, but migrate toward `sessionsByKey` |
| `selectedFile` | Keep in workspace |
| `sessionFiles` | Keep in workspace |
| `previewInfo` | Keep in workspace, but enforce a single writer |
| `selectedSessions: Set<string>` | Migrate to `Set<SessionKey>` |
| `header run status` | Derive |
| `active execution` | Derive |
| `active session title/spec` | Derive |
| `active chat/log/nodes/summary` | Derive |

---

## 3.4 Derived state rules

### Rule 1 — active execution

```ts
activeExecution = execution.sessionsByKey[getSessionKey(workspace.activeSessionRef)]
```

### Rule 2 — header run status

Prefer live execution, then active execution:

```ts
headerRunStatus =
  liveExecution?.runStatus
  ?? activeExecution?.runStatus
  ?? "idle"
```

### Rule 3 — active session title

```ts
activeSessionTitle =
  activeExecution?.title
  ?? sessionMetaFromProjects?.spec
  ?? ""
```

### Rule 4 — active chat/log/nodes/runStatus
All must derive from the same active execution source.

Do not mix:
- messages from prop sessionId
- runStatus from execution.activeSessionId
- retry target from reconstructed active session

---

# 4. New selectors and services

## 4.1 Workspace selectors
Suggested file:

- `apps/web/src/domains/workspace/selectors.ts`

Add selectors such as:

- `selectActiveSessionRef`
- `selectActiveSessionKey`
- `selectFlatSessions`
- `selectSessionMetaByKey`
- `selectSelectedSessionKeys`
- `selectSelectedSessionCount`
- `selectActiveSessionFiles`
- `selectPreviewInfo`
- `selectCanOpenPreview`
- `selectResumeInfo`
- `selectResumeTargetRef`

## 4.2 Execution selectors
Suggested file:

- `apps/web/src/domains/execution/selectors.ts`

Add selectors such as:

- `selectExecutionByKey(key)`
- `selectExecutionByRef(ref)`
- `selectLiveSessionKey`
- `selectLiveExecution`
- `selectRunStatusByKey(key)`
- `selectChatMessagesByKey(key)`
- `selectLogNodesByKey(key)`
- `selectLogsByKey(key)`

## 4.3 Cross-domain selectors
Suggested new file:

- `apps/web/src/domains/session/selectors.ts`

Because these selectors combine workspace + execution and do not belong cleanly in one domain.

Suggested selectors:

- `selectActiveExecution`
- `selectActiveRunStatus`
- `selectHeaderRunStatus`
- `selectActiveSessionTitle`
- `selectActiveNodes`
- `selectActiveLogs`
- `selectActiveChatMessages`
- `selectIsViewingLiveSession`

## 4.4 Session service / action layer
Suggested file:

- `apps/web/src/domains/session/service.ts`

Alternative location:

- `apps/web/src/features/session/useSessionActions.ts`

Suggested responsibilities:

- `selectSession(ref | null)`
- `loadSessionSnapshot(ref, options?)`
- `activateStartedSession(ref)`
- `resumeSession(targetRef?)`
- `clearActiveSession()`
- `handleDeletedSession(ref)`
- `ensureExecutionSession(ref)`
- `ingestRealtimeEvent(event)`

This layer should not own state. It should orchestrate workspace + execution changes.

---

# 5. Phase plan

## Phase 1 — State ownership cleanup

### Objective
Remove duplicated ownership of session state and introduce explicit identity + selectors.

### Changes
- introduce `SessionRef` / `SessionKey`
- stop storing `spec` inside active selection
- remove `useSession` local `activeSession`
- remove `useSession` local `resumeInfo`
- remove `execution.activeSessionId`
- add workspace/execution/session selectors
- add session service / action layer
- move active-session cleanup into session service

### Files to touch
- `apps/web/src/features/session/types.ts`
- `apps/web/src/domains/workspace/types.ts`
- `apps/web/src/domains/workspace/store.ts`
- `apps/web/src/domains/workspace/selectors.ts`
- `apps/web/src/domains/execution/store.ts`
- `apps/web/src/domains/execution/selectors.ts`
- `apps/web/src/domains/session/service.ts` (new)
- `apps/web/src/domains/session/selectors.ts` (new)
- `apps/web/src/features/session/useSession.ts`
- `apps/web/src/hooks/useSSE.ts`

### Output of this phase
- one owner for active session selection
- one owner for resume info
- explicit session identity model
- session-safe keying strategy

---

## Phase 2 — Split `ProjectPanel`

### Objective
Turn `ProjectPanel` into a lightweight feature container and move rendering/model/actions apart.

### Current responsibilities to split
- read workspace/controller state
- flatten projects into session rows
- derive active/selected/starred row state
- control selection mode
- call delete/star APIs
- patch workspace store after success
- clear active session when deleted
- render file list

### Target structure

Suggested files:

- `apps/web/src/features/session/ProjectPanel.tsx`
- `apps/web/src/features/session/ProjectPanelView.tsx`
- `apps/web/src/features/session/SessionList.tsx`
- `apps/web/src/features/session/SessionListItem.tsx`
- `apps/web/src/features/session/SessionFilesList.tsx`
- `apps/web/src/features/session/useProjectPanelModel.ts`
- `apps/web/src/features/session/useProjectPanelActions.ts`
- `apps/web/src/features/session/projectPanel.types.ts`

### Suggested view model types
- `SessionRowVM`
- `FileRowVM`
- `ProjectPanelViewProps`

### Important changes
- migrate selected session keys to `SessionKey`
- stop using raw store setters in the panel
- route delete/batch-delete active-session cleanup through session service
- gradually stop using `useWorkspaceController()` inside the panel

### Migration order
1. add panel types + selectors
2. extract `useProjectPanelModel`
3. extract `useProjectPanelActions`
4. extract `ProjectPanelView` and list subcomponents
5. shrink or retire `workspace/controller.ts`

---

## Phase 3 — Split `Chat`

### Objective
Separate chat rendering from chat action orchestration and session-bridging logic.

### Current responsibilities to split
- tabs shell
- log view
- message rendering
- local/store message bridging
- PRD confirm/discard
- retry session
- direct execution store reads/writes
- controller creation and run orchestration

### Target structure

Suggested files:

- `apps/web/src/features/chat/Chat.tsx`
- `apps/web/src/features/chat/containers/ChatPanelContainer.tsx`
- `apps/web/src/features/chat/containers/LogPanelContainer.tsx`
- `apps/web/src/features/chat/hooks/useChatPanelState.ts`
- `apps/web/src/features/chat/hooks/useChatActions.ts`
- `apps/web/src/features/chat/hooks/useChatSessionBridge.ts`
- `apps/web/src/features/chat/components/ChatView.tsx`
- `apps/web/src/features/chat/components/ChatMessageList.tsx`
- `apps/web/src/features/chat/components/ChatMessageItem.tsx`
- `apps/web/src/features/chat/components/ChatComposer.tsx`
- `apps/web/src/features/chat/components/ChatRunStatusBar.tsx`
- `apps/web/src/features/chat/components/LogView.tsx`
- `apps/web/src/features/chat/components/LogNodeItem.tsx`
- `apps/web/src/features/chat/components/PRDConfirmedBanner.tsx`
- `apps/web/src/features/chat/selectors/chatSelectors.ts`
- `apps/web/src/features/chat/types/chatViewModel.ts`

### Boundary rule
Chat must stop mixing:
- `sessionId` prop
- `execution.activeSessionId`
- reconstructed active session objects

It should use one session source only.

### Migration order
1. add chat/log selectors
2. split `LogPanel` out first
3. extract `ChatView` and message subcomponents
4. extract `useChatActions`
5. extract `useChatSessionBridge`
6. pass standardized `sessionRef` or use cross-domain active selectors only

---

## Phase 4 — Split `Canvas` and `NodeDetail`

### Objective
Separate graph adaptation, node actions, and node inspector rendering.

### Current responsibilities to split
- execution store selection
- graph adaptation for ReactFlow
- layout signature and fitView
- node selection state
- node detail rendering
- retry/edit actions
- impact analysis state

### Target structure

Suggested files:

- `apps/web/src/features/canvas/Canvas.tsx`
- `apps/web/src/features/canvas/containers/CanvasContainer.tsx`
- `apps/web/src/features/canvas/containers/NodeInspectorContainer.tsx`
- `apps/web/src/features/canvas/hooks/useCanvasExecution.ts`
- `apps/web/src/features/canvas/hooks/useCanvasGraph.ts`
- `apps/web/src/features/canvas/hooks/useCanvasSelection.ts`
- `apps/web/src/features/canvas/hooks/useNodeActions.ts`
- `apps/web/src/features/canvas/hooks/useFitViewOnGraphChange.ts`
- `apps/web/src/features/canvas/components/CanvasView.tsx`
- `apps/web/src/features/canvas/components/NodeCard.tsx`
- `apps/web/src/features/canvas/components/NodeInspector.tsx`
- `apps/web/src/features/canvas/components/BlockedDependencyList.tsx`
- `apps/web/src/features/canvas/components/ToolCallTimeline.tsx`
- `apps/web/src/features/canvas/components/FilesWrittenList.tsx`
- `apps/web/src/features/canvas/components/VerificationList.tsx`
- `apps/web/src/features/canvas/components/NodeErrorPanel.tsx`
- `apps/web/src/features/canvas/components/NodeEditSection.tsx`
- `apps/web/src/features/canvas/adapters/graphViewModel.ts`
- `apps/web/src/features/canvas/selectors/canvasSelectors.ts`

### Boundary rule
Canvas should not derive active session via `execution.activeSessionId`.
It should receive or derive session context from the workspace-selected session + execution cache.

### Migration order
1. add canvas selectors
2. extract `NodeCard` and presentation constants
3. extract `useCanvasGraph`
4. split `NodeInspectorContainer` and `NodeInspector`
5. extract `useNodeActions`
6. extract inspector subcomponents
7. extract fitView hook

---

## Phase 5 — Reduce orchestration in `App.tsx`

### Objective
Turn `App` into a shell instead of a cross-feature coordinator.

### Current responsibilities to move out
- preview refresh orchestration
- session/panel switching cleanup
- file/session mismatch cleanup
- central panel switching rules

### Target structure

Suggested additions:

- `apps/web/src/features/workspace/WorkspaceShell.tsx`
- `apps/web/src/features/workspace/useWorkspaceShell.ts`

### Desired end state
`App.tsx` should mainly:
- render header
- render resume bar
- render left / center / right shell
- call prepared actions/hooks

---

# 6. Specific file guidance

## 6.1 `features/session/useSession.ts`
Refactor it from state owner into a thin action/service hook.

It should:
- stop owning local `activeSession`
- stop owning local `resumeInfo`
- read from workspace selectors
- delegate orchestration to session service

## 6.2 `domains/workspace/controller.ts`
Short-term:
- stop using it as a mutation entrypoint for feature components
- decide whether it is the only writer for preview/sessionFiles polling

Mid-term:
- split into dedicated sync hooks or retire it

## 6.3 `hooks/useSSE.ts`
Update event ingestion rules:
- prefer explicit event session identity
- fallback to live session only if event identity is missing
- never fallback to active selected session

## 6.4 `features/files/useFilePreview.ts`
Keep for now.
But move “clear file on session switch” into session service or workspace reset logic.

---

# 7. Recommended PR sequence

## PR 1 — Identity + selectors foundation
- add `SessionRef` / `SessionKey`
- add session key helpers
- add workspace/execution/session selectors
- migrate selected session set to `SessionKey`

## PR 2 — State ownership cleanup
- remove `useSession` local state duplication
- remove `execution.activeSessionId`
- add session service / actions
- update `App`, `Chat`, `Canvas` to read active execution from selectors

## PR 3 — ProjectPanel split
- add panel types
- extract model hook
- extract actions hook
- extract view/list components
- stop direct API/store orchestration in the panel

## PR 4 — Chat split
- add chat selectors
- extract `LogPanel`
- extract `ChatView`
- extract `useChatActions`
- extract `useChatSessionBridge`

## PR 5 — Canvas split
- add canvas selectors
- extract `NodeCard`
- extract `useCanvasGraph`
- split node inspector
- extract `useNodeActions`

## PR 6 — App shell cleanup
- move panel orchestration to workspace shell hook
- simplify `App.tsx`

---

# 8. Validation checklist

After each phase or PR, verify:

- active session switching still works
- resume flow still works
- deleting the active session clears the correct UI state
- batch delete still works
- preview status still updates correctly
- selected file is cleared correctly on session switch
- chat history is still scoped correctly per session
- canvas still shows the correct active session graph
- node retry/edit still works
- SSE updates land on the correct session
- build and typecheck still pass

---

# 9. Suggested first slice

If implementation starts immediately, the best first slice is:

1. define `SessionRef` / `SessionKey`
2. add cross-domain selectors
3. remove duplicate `activeSession` / `resumeInfo` ownership
4. introduce session service / action pipeline
5. switch `App`, `ProjectPanel`, `Chat`, and `Canvas` to the new source of truth

This creates the foundation for all later component-level splits.
