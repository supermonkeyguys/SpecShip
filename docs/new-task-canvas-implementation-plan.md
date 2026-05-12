# New Task → PRD → Canvas Implementation Plan

## Status
Draft v0.1 — based on `docs/new-task-canvas-state-machine.md` on 2026-05-09

---

## Purpose

This document translates the product/state-machine proposal into a concrete frontend implementation plan for the current Shipyard codebase.

It is intentionally:

- incremental
- low-risk
- file-oriented
- aligned with the current `apps/web/src` structure

The goal is **not** to rewrite the app. The goal is to introduce a first-class **new-task creation surface** while reusing the current session, PRD, and execution infrastructure.

---

## Guiding implementation principles

### 1. Treat creation and execution as sibling surfaces
Do **not** turn `Canvas` into a mixed empty-state / pre-run container.

Instead:

- `TaskCreationScreen` handles pre-run definition flow
- `Canvas` handles execution-only flow

### 2. Reuse existing orchestration first
The current code already has useful orchestration in:

- `features/chat/containers/ChatPanelContainer.tsx`
- `domains/execution/runController.ts`
- `features/session/useSession.ts`

The first implementation should reuse these pieces rather than rebuild logic from scratch.

### 3. Prefer explicit surface variants over more booleans
We should move toward:

- explicit center surface selection
- explicit creation flow stage

rather than further growing scattered booleans and fallback rendering.

### 4. Deliver in phases
The first pass should change the product shape with minimal backend change and minimal risk to execution behavior.

---

# 1. Current frontend shape

## Main entry
`apps/web/src/App.tsx`

Current center-area routing is effectively:

- file preview
- settings
- preview
- canvas (fallback)

Current right rail is always rendered as `Chat`.

## Session lifecycle
`apps/web/src/features/session/useSession.ts`

This already owns:

- selecting a session
- activating a started session
- resuming a session
- creating “new session” state by clearing `activeSession`

## Chat orchestration
`apps/web/src/features/chat/containers/ChatPanelContainer.tsx`

This already handles:

- local draft messages when there is no session
- per-session message storage once a session exists
- PRD confirm/discard flow
- run start flow

## Workspace UI store
`apps/web/src/domains/workspace/store.ts`

This currently owns:

- `activeSession`
- selected file
- preview info
- settings/preview state lives outside this store today

This store is the natural first place to introduce center-surface state.

---

# 2. Target implementation outcome

After implementation, the expected behavior should be:

## Startup
If there is no active session, the center area renders **Task Creation Screen**, not canvas.

## Clicking `+ New`
The app exits canvas mode and enters the **new-task surface**.

## Submitting a task
The task creation flow should support:

- freeform spec input
- optional clarification
- PRD generation/review
- PRD confirmation
- run start

## Starting a run
When run starts successfully:

- active session becomes the newly started session
- center switches to canvas
- right rail becomes chat/logs for the active session

## Viewing files / preview / settings
These continue to work as separate workspace surfaces.

---

# 3. Recommended rollout phases

## Phase 1 — Introduce surface architecture and new task screen

Goal:

- show `TaskCreationScreen` whenever there is no active session
- keep existing canvas/session behavior intact
- hide the right rail in new-task mode

No major orchestration rewrite yet.

## Phase 2 — Move pre-run interaction into task creation feature

Goal:

- reuse existing PRD + run flow
- center the experience visually
- make new-task a first-class feature, not just “chat without session”

## Phase 3 — Formalize store-backed workspace surface state

Goal:

- replace ad hoc center routing with explicit `WorkspaceSurface`
- reduce branching inside `App.tsx`

## Phase 4 — Introduce explicit creation flow state

Goal:

- move away from `pendingPRD + loading + local inference`
- track stages like `clarifying`, `reviewing_prd`, `starting_run`

---

# 4. File-by-file implementation plan

Below is the recommended file mapping.

---

## 4.1 `apps/web/src/App.tsx`

### Current role
- app shell
- layout orchestration
- preview refresh logic
- center area branching
- right rail always mounted

### Required changes

#### Phase 1
Replace the current fallback `<Canvas />` decision with a dedicated center surface component.

Current pattern:

```tsx
selectedFile ? <FilePreview />
: isSettingsOpen ? <SettingsPanel />
: isPreviewOpen ? <PreviewPanel />
: <Canvas />
```

Target direction:

```tsx
<CenterSurface />
```

#### Phase 1 behavior rule
If:

- `selectedFile` exists → `FilePreview`
- `isSettingsOpen` → `SettingsPanel`
- `isPreviewOpen` → `PreviewPanel`
- `activeSession` exists → `Canvas`
- otherwise → `TaskCreationScreen`

#### Phase 1 right rail rule
Only render the right rail `Chat` when there is an active session.

In `new-task` state:

- do not render the right rail, or
- render an empty spacer for layout stability

Recommended first pass: **hide right rail entirely in new-task state**.

### Result
`App.tsx` becomes simpler and expresses the two-stage product shape.

---

## 4.2 NEW: `apps/web/src/features/workspace/CenterSurface.tsx`

### Why add this file
Move center surface routing out of `App.tsx`.

### Responsibilities
- receive the already-derived shell state
- decide which major center surface to render

### Suggested props

```ts
interface CenterSurfaceProps {
  activeSession: SessionRef | null;
  selectedFile: SelectedFileIdentity | null;
  isSettingsOpen: boolean;
  isPreviewOpen: boolean;
  previewInfo: PreviewStatusResponse | null;
  onCloseSettings: () => void;
  onClosePreview: () => void;
  onRefreshPreview: () => Promise<void> | void;
  onRunStarted: (session: ActiveSession) => Promise<void> | void;
  onResumeRequested: () => Promise<void> | void;
}
```

### Render rules
- file → `FilePreview`
- settings → `SettingsPanel`
- preview → `PreviewPanel`
- canvas → `Canvas`
- else → `TaskCreationScreen`

---

## 4.3 NEW: `apps/web/src/features/task-creation/TaskCreationScreen.tsx`

### Why add a new feature
The new-task flow should become a dedicated feature instead of being an implicit byproduct of `ChatPanelContainer` with `sessionRef === undefined`.

### Responsibilities
- render the center-stage task definition UI
- own the pre-run user interaction flow
- reuse current run/PRD orchestration
- remain independent from canvas rendering

### Suggested high-level structure

```tsx
<TaskCreationScreen>
  <TaskCreationHero />
  <TaskCreationConversation />
  <TaskCreationComposer />
</TaskCreationScreen>
```

### MVP behavior
- show welcome/empty state if there are no draft messages yet
- show conversation-like messages as the user interacts
- show PRD editor inline when PRD is generated
- after run starts successfully, rely on `onRunStarted` to transition app into canvas mode

### Important note
This screen should not initially re-implement all logic from scratch. It should first **wrap/adapt current chat-run logic**.

---

## 4.4 NEW: `apps/web/src/features/task-creation/TaskCreationContainer.tsx`

### Why
Separate orchestration from the centered view.

### Responsibilities
- own input state for new-task mode
- call clarify / PRD / run logic
- manage local draft messages
- call `onRunStarted` when the new execution session is created

### Implementation options

#### Option A — fastest path
Extract shared logic out of `ChatPanelContainer` into a reusable hook, then use it from both:

- `TaskCreationContainer`
- `ChatPanelContainer`

#### Option B — acceptable MVP
Move most pre-run logic from `ChatPanelContainer` into `TaskCreationContainer`, and simplify `ChatPanelContainer` so that it becomes execution-only.

### Recommendation
Prefer **Option A** if the extraction is small and clean.
Otherwise use **Option B** for clarity and lower immediate complexity.

---

## 4.5 NEW: `apps/web/src/features/task-creation/useTaskCreationFlow.ts`

### Why
The pre-run orchestration should not live in a view component.

### Responsibilities
Encapsulate:

- input text state
- message history
- loading state
- clarification state
- PRD pending state
- confirm/discard behavior
- run-start state

### Suggested initial return shape

```ts
interface UseTaskCreationFlowResult {
  input: string;
  loading: boolean;
  messages: Message[];
  clarification: ClarifyQuestion[] | null;
  pendingPRD: PRDPending | null;
  prdText: string | null;
  setInput: (value: string) => void;
  send: () => Promise<void>;
  confirmClarification: (answers: Record<string, string>) => Promise<void>;
  skipClarification: () => Promise<void>;
  confirmPRD: (prd: string) => Promise<void>;
  discardPRD: () => Promise<void>;
}
```

### Phase 1 shortcut
You may initially keep `messages/loading/pendingPRD` inside `TaskCreationContainer` if that speeds up delivery, but this hook is the correct target shape.

---

## 4.6 NEW: `apps/web/src/features/task-creation/TaskCreationView.tsx`

### Why
Provide a centered agent-style layout distinct from the right-rail chat layout.

### Responsibilities
- visual framing
- message list placement
- composer placement
- hero/empty state placement
- inline clarification/PRD cards

### Reuse opportunities
This view should **reuse existing render pieces** where possible:

- `features/chat/views/ChatMessageList.tsx`
- `features/chat/PRDEditor.tsx`
- `features/chat/ClarificationCard.tsx`

However, the overall page layout should be new.

---

## 4.7 `apps/web/src/features/chat/Chat.tsx`

### Current role
- right-rail shell
- chat/log tabs
- always mounted in `App.tsx`

### Required changes

#### Phase 1
No major internal logic change required.

But the parent (`App.tsx`) should only mount this component when there is an active session.

#### Phase 2 recommendation
Make `Chat` explicitly execution-only.

That means:
- it should assume `sessionRef` normally exists
- it should stop acting as the host for the app’s pre-run creation experience

This simplifies its role significantly.

---

## 4.8 `apps/web/src/features/chat/containers/ChatPanelContainer.tsx`

### Current role
Mixed responsibility:
- pre-run draft messages
- session chat messages
- PRD flow
- retry flow
- run start flow

### Required changes

#### Phase 1
Minimal change possible if `Chat` is not mounted in new-task mode.

#### Phase 2
Refactor toward execution-only responsibilities:

Keep:
- session-scoped message rendering
- retry actions
- status/reply interactions during execution
- PRD messages only if they are generated inside an active session in the future

Move out:
- initial task creation flow
- draft-only messages when `sessionRef` is undefined
- centered new-task orchestration

### Recommended extraction target
Shared logic candidates to extract:

- send + intent handling wrapper
- PRD confirm/discard behavior
- run start callback bridging

Possible shared hook:

- `useRunIntentFlow()` or
- `useSpecConversationFlow()`

---

## 4.9 `apps/web/src/domains/execution/runController.ts`

### Current role
Provides orchestration for:
- `chatIntent`
- PRD generation
- retry node
- run start
- resume

### Required changes

This file should be **kept and reused**, not replaced.

### Recommended adjustments

#### Add clarification support here or in adjacent orchestration hook
At the moment, clarification capability exists in `shared/api/clarifyClient.ts` but is not wired into the visible interaction flow.

You have two reasonable choices:

##### Choice A
Keep `runController.ts` focused on run/chat/PRD only, and let `useTaskCreationFlow` call `clarifySpec()` before invoking controller methods.

##### Choice B
Extend `runController.ts` so it becomes the full orchestrator for:
- clarification
- PRD generation
- run start

### Recommendation
Prefer **Choice A** for cleaner boundaries.

Reason:
- clarification is specific to task creation
- retry/resume are specific to execution
- splitting them keeps `runController.ts` from becoming a god module

---

## 4.10 `apps/web/src/shared/api/clarifyClient.ts`

### Current role
Exists and normalizes clarify response payloads.

### Required changes
None required for MVP.

### New usage
This should be called from the new task creation flow before PRD generation.

### Important note
Current code search suggests clarification UI exists but is not yet wired into the real user flow.
That makes this file a good reuse point.

---

## 4.11 `apps/web/src/features/chat/ClarificationCard.tsx`
## 4.12 `apps/web/src/features/chat/PRDEditor.tsx`

### Current role
Reusable view wrappers.

### Required changes
No major change required.

### New usage
Both should be reused inside the new task creation experience.

This is good because:
- the components already exist
- product consistency remains high
- implementation cost stays low

---

## 4.13 `apps/web/src/features/session/useSession.ts`

### Current role
Owns:
- selecting session
- activating started session
- resuming session
- clearing active session for new-session mode

### Required changes

#### Phase 1
No behavioral rewrite required.

This hook already supports the key transition we need:

- `handleNewSession()` → clears active session
- `activateStartedSession()` → enters running session state

#### Phase 2/3 possible refinement
Instead of only clearing `activeSession`, it may later also set an explicit workspace surface such as `new-task`.

But for MVP, current behavior is enough.

---

## 4.14 `apps/web/src/features/workspace/useWorkspaceShell.ts`

### Current role
Owns:
- preview/settings panel toggling
- new session shell transition
- session selection shell cleanup

### Required changes

#### Phase 1
Minimal change:
- keep existing preview/settings behavior
- continue to close transient panels on `handleCreateNewSession`

#### Phase 3
This hook is a likely place to migrate from booleans to explicit surface transitions once `WorkspaceSurface` is introduced.

Potential future target:

- `openSurface("preview")`
- `openSurface("settings")`
- `openSurface("new-task")`
- `openSurface("canvas")`

For now, do not over-refactor it.

---

## 4.15 `apps/web/src/domains/workspace/store.ts`

### Current role
Holds workspace-scoped UI and resource state.

### Required changes

#### Phase 1
No required breaking change.

#### Phase 3 target
Add explicit center-surface state.

Suggested shape:

```ts
type WorkspaceSurface =
  | { type: "new-task" }
  | { type: "canvas" }
  | { type: "file" }
  | { type: "preview" }
  | { type: "settings" };
```

Then expand later to carry payloads if needed.

### Suggested store additions in Phase 3

```ts
surface: WorkspaceSurface;
setSurface: (surface: WorkspaceSurface) => void;
```

### MVP note
Do not block delivery on this change. The first pass can infer new-task from `activeSession === null`.

---

## 4.16 `apps/web/src/domains/workspace/types.ts`

### Required changes

#### Phase 3 target
Extend `WorkspaceState` with:

- `surface`
- optionally `creationFlow` once formalized

Possible future addition:

```ts
interface WorkspaceState {
  ...
  surface: WorkspaceSurface;
  creationFlow?: CreationFlow;
}
```

### MVP note
Skip for first pass if using derived surface rules in `App.tsx` / `CenterSurface`.

---

## 4.17 `apps/web/src/domains/workspace/selectors.ts`

### Required changes

#### Phase 3
Add selectors for:
- current surface
- “is new-task surface”
- “should show right rail”

Potential selectors:

```ts
export function selectSurface(state: WorkspaceState) {}
export function selectIsNewTaskSurface(state: WorkspaceState) {}
export function selectShouldShowExecutionRail(state: WorkspaceState) {}
```

### Benefit
This keeps `App.tsx` lean once surface state becomes explicit.

---

## 4.18 `apps/web/src/features/session/ProjectPanel.tsx`
## 4.19 `apps/web/src/features/session/useProjectPanelActions.ts`
## 4.20 `apps/web/src/features/session/views/PanelHeader.tsx`

### Current role
The left rail currently triggers `onNewSession` from the `+ New` button.

### Required changes

#### Phase 1
No structural changes required.

The existing `onNewSession` behavior is the correct user entry into the new-task surface.

#### Optional UX enhancement
In a later pass, `PanelHeader` may visually reflect when the app is in `new-task` mode.
For example:
- highlight the `+ New` result state
- or show a small “Drafting” badge

This is optional and should not block the first implementation.

---

## 4.21 `apps/web/src/features/session/useProjectPanelModel.ts`

### Required changes
No required change for MVP.

### Optional future enhancement
If `new-task` becomes explicit in store state, this hook may expose that status so the sidebar can visually indicate it.

---

## 4.22 `apps/web/src/domains/execution/store.ts`

### Current role
Owns per-session execution state and session chat history.

### Required changes

#### MVP
No breaking changes required.

#### Recommendation
Do **not** store new-task draft conversation in execution store.

Reason:
- draft creation state is not an execution session yet
- execution store should remain session-scoped

### Where draft messages should live
For MVP:
- local state inside `TaskCreationContainer`, or
- a small dedicated creation-flow hook

For later:
- workspace store or a dedicated draft store

---

# 5. Proposed new feature tree

Recommended new files:

```text
apps/web/src/features/task-creation/
  TaskCreationScreen.tsx
  TaskCreationContainer.tsx
  TaskCreationView.tsx
  useTaskCreationFlow.ts
  taskCreation.types.ts
```

Optional if the feature grows:

```text
  views/
    TaskCreationHero.tsx
    TaskCreationComposer.tsx
    TaskCreationMessageList.tsx
```

For MVP, keep it shallow.

---

# 6. Recommended MVP wiring strategy

## Step 1 — Create `TaskCreationScreen`
Implement a centered surface that can at minimum:

- show an input box
- submit a prompt
- show AI/system/user messages
- show PRD editor when generated

## Step 2 — Mount `TaskCreationScreen` from `App.tsx`
Rule:

- no active session + no file/settings/preview surface → `TaskCreationScreen`

## Step 3 — Hide `Chat` right rail when no active session
This makes the product visually shift into task-definition mode.

## Step 4 — Reuse PRD flow
Wire through existing:

- `createChatRunController()`
- `generatePRD()`
- `runSpec()`
- `activateStartedSession()`

## Step 5 — Add clarification before PRD generation
Suggested initial sequence inside `useTaskCreationFlow`:

1. user submits spec
2. call `clarifySpec(spec)`
3. if clarification needed → show `ClarificationCard`
4. once answered or skipped → generate PRD
5. show `PRDEditor`
6. confirm → start run

---

# 7. Concrete sequencing recommendation

## Recommended implementation order

### Pass 1
- add `TaskCreationScreen`
- add `CenterSurface`
- update `App.tsx` to use it
- only mount right rail `Chat` when session exists

### Pass 2
- add `useTaskCreationFlow`
- move pre-run orchestration out of `ChatPanelContainer`
- reuse `PRDEditor` and `ClarificationCard`

### Pass 3
- simplify `ChatPanelContainer` into execution-only panel
- remove `sessionRef === undefined` draft-mode assumptions

### Pass 4
- introduce explicit `WorkspaceSurface` in store
- optionally introduce `CreationFlow` in store

---

# 8. Risks and mitigations

## Risk 1 — duplicated logic between new-task screen and chat panel

### Mitigation
Extract only the orchestration that is actually shared.
Do not force premature deep abstraction.

## Risk 2 — too much state moved too early

### Mitigation
Phase 1 should keep draft state local to the new feature.
Only promote state to workspace store when the surface model stabilizes.

## Risk 3 — canvas/session regressions

### Mitigation
Do not modify `Canvas`, `useSession`, or execution store behavior in the first pass beyond mounting logic.

## Risk 4 — clarification flow complexity

### Mitigation
Implement clarification only inside the new-task feature.
Do not entangle it with execution chat behavior yet.

---

# 9. Definition of done for MVP

The MVP should be considered complete when:

1. Clicking `+ New` no longer shows an empty canvas.
2. Startup without active session shows a centered task-creation screen.
3. The centered screen supports spec input and message display.
4. PRD generation appears in the centered flow.
5. PRD confirmation starts a real run.
6. Successful run start transitions into the canvas workspace.
7. Existing active-session canvas behavior still works.
8. File preview / settings / preview panels still work.

---

# 10. Suggested immediate next coding task

The best first implementation slice is:

1. create `features/task-creation/TaskCreationScreen.tsx`
2. create `features/workspace/CenterSurface.tsx`
3. update `App.tsx` to mount `CenterSurface`
4. hide `Chat` when there is no active session
5. temporarily implement a minimal centered input flow
6. then connect PRD + clarify + run orchestration

This gives the product the new shape quickly without destabilizing execution logic.

---

## Summary

The implementation should be staged like this:

- **first** change the workspace shape
- **then** move pre-run orchestration into a dedicated task-creation feature
- **then** formalize store-level surface and creation-flow state

This keeps the code aligned with the proposed state machine while staying compatible with the current Shipyard frontend structure.
