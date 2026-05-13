# Plan.md Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the PRD flow with a structured plan.md flow: spec → clarify → plan.md (user confirms/edits) → deterministic parse → execute.

**Architecture:** Add `plan-generator.ts` (LLM → plan.md text) and `plan-parser.ts` (plan.md → PlannerPlan, no LLM) to `packages/core`. Add `POST /api/plan` route in `apps/server`. Extend `POST /api/run` with `mode: "plan"` to skip LLM planning. Replace PRD UI components with a plan editor that supports simple/expert mode switching.

**Tech Stack:** TypeScript, Express, React 19, Zustand 5, existing `PlannerPlan` type from `packages/core/src/orchestrator/planner.ts`

---

## File Map

**New files:**
- `packages/core/src/orchestrator/plan-generator.ts` — LLM call → plan.md string
- `packages/core/src/orchestrator/plan-parser.ts` — deterministic plan.md → PlanParseResult
- `apps/server/src/routes/plan.ts` — POST /api/plan route
- `apps/web/src/shared/api/planClient.ts` — frontend API client (replaces prdClient.ts)
- `apps/web/src/features/task-creation/PlanEditorCard.tsx` — plan review card (simple+expert mode)

**Modified files:**
- `packages/core/src/ai/prompts.ts` — add PLAN_GENERATOR_PROMPT
- `packages/core/src/orchestrator/index.ts` — export new modules
- `packages/shared/src/types.ts` — add PlanRequest/PlanResponse, rename PRDMessage→PlanMessage, add mode to RunRequest
- `apps/server/src/index.ts` — register planRouter, deprecate prdRouter
- `apps/server/src/routes/run.ts` — handle mode: "plan" by calling parsePlan() instead of buildGraph()
- `apps/web/src/domains/execution/types.ts` — PRDMessage → PlanMessage
- `apps/web/src/domains/workspace/types.ts` — CreationPendingPRD → CreationPendingPlan, stage "reviewing_prd" → "reviewing_plan"
- `apps/web/src/domains/workspace/store.ts` — pendingPRD → pendingPlan
- `apps/web/src/features/task-creation/useTaskCreationFlow.ts` — wire generatePlan, confirmPlan, discardPlan
- `apps/web/src/features/task-creation/TaskCreationView.tsx` — onPRDConfirm/Discard → onPlanConfirm/Discard
- `apps/web/src/features/task-creation/TaskCreationContainer.tsx` — prop rename
- `apps/web/src/features/chat/views/ChatMessageItem.tsx` — render PlanMessage
- `apps/web/src/features/chat/views/PRDEditorView.tsx` — rename to PlanEditorView (or reuse)
- `apps/web/src/features/chat/containers/ChatPanelContainer.tsx` — prd → plan message role

---

## Task 1: Add PLAN_GENERATOR_PROMPT to prompts.ts

**Files:**
- Modify: `packages/core/src/ai/prompts.ts`

- [ ] **Step 1: Add the prompt after PRD_GENERATOR_PROMPT**

Open `packages/core/src/ai/prompts.ts` and append after `PRD_GENERATOR_PROMPT`:

```typescript
export const PLAN_GENERATOR_PROMPT = `
You are a senior software architect. Given a spec or rough idea, produce a structured plan.md document.

Output ONLY the Markdown document below — no preamble, no explanation:

# <title: max 60 chars>

## 目标
One paragraph: what problem this solves and what success looks like.

## 技术约束
- Bullet list of tech stack and explicit constraints

## 假设
- Bullet list of assumptions made to fill gaps

---

## 步骤

### step: <kebab-case-id>
- title: <human readable title>
- role: <types|implementer|tester|integrator|checkpoint>
- file: <output/relative/path.ts>
- depends: [<id>, ...]
- checkpoint: false
- task: |
    <concrete task: list every function/interface name, param types, return types, import paths>
- acceptance: |
    exports: [SymbolA, SymbolB]
    compile: true

(repeat ### step: for each node)

Rules:
- Each step produces ONE file with a unique path
- Use outputFile prefix "output/" unless spec specifies otherwise
- depends: [] for steps with no upstream dependency
- checkpoint steps: role=checkpoint, file ends in .md, checkpoint: true
- task must be written to function/interface signature level — not vague
- acceptance: list exact export names and compile: true/false
- Split steps so each file is under ~80 lines of generated code
- Maximize parallelism: steps that don't share imports → empty depends
- Write in Chinese if the original request is in Chinese, English otherwise
`.trim();
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/cookie/project/shipyard && pnpm typecheck 2>&1 | tail -5
```
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/ai/prompts.ts
git commit -m "feat: add PLAN_GENERATOR_PROMPT"
```

---

## Task 2: Add plan-generator.ts

**Files:**
- Create: `packages/core/src/orchestrator/plan-generator.ts`

- [ ] **Step 1: Create the file**

```typescript
// packages/core/src/orchestrator/plan-generator.ts
import * as fs from "fs";
import * as path from "path";
import { ShipyardConfig } from "../config";
import { PLAN_GENERATOR_PROMPT } from "../ai/prompts";
import { runAgent as defaultRunAgent } from "../ai/llm";
import { makeLLMConfig } from "../ai/llm-config";
import { routeModel } from "./model-router";
import type { AgentRunner } from "./runtime-types";

/**
 * Generate a structured plan.md from a spec string.
 * Returns the raw Markdown text. Persists to session dir if projectId+sessionId set.
 */
export async function generatePlan(
  spec: string,
  config: ShipyardConfig,
  agentRunner: AgentRunner = defaultRunAgent
): Promise<string> {
  const route = routeModel(config, { phase: "plan", executionMode: config.executionMode ?? "sandbox-output" });
  const llmConfig = makeLLMConfig(route.model, config);

  const { finalText } = await agentRunner(
    PLAN_GENERATOR_PROMPT,
    spec,
    config.workDir,
    llmConfig,
    false
  );

  // Persist to session directory if available
  if (config.projectId && config.sessionId) {
    const sessionDir = path.join(
      config.workDir,
      ".shipyard",
      "projects",
      config.projectId,
      "sessions",
      config.sessionId
    );
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(path.join(sessionDir, "plan.md"), finalText, "utf-8");
  }

  return finalText;
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/cookie/project/shipyard && pnpm typecheck 2>&1 | tail -5
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/orchestrator/plan-generator.ts
git commit -m "feat: add plan-generator"
```

---

## Task 3: Add plan-parser.ts

**Files:**
- Create: `packages/core/src/orchestrator/plan-parser.ts`

This is the critical deterministic parser — no LLM, pure string parsing.

- [ ] **Step 1: Create the file**

```typescript
// packages/core/src/orchestrator/plan-parser.ts
import { ShipyardConfig } from "../config";
import { validatePlanData } from "./planner";
import type { TaskStrategy } from "../strategies/base";

// Re-use the internal PlannerPlan shape from planner.ts
// We export a stable public type here.
export interface ParsedPlanStep {
  id: string;
  title: string;
  role: string;
  file: string;
  depends: string[];
  checkpoint: boolean;
  task: string;
  acceptance: string;
}

export interface ParsedPlan {
  title: string;
  goal: string;
  constraints: string[];
  assumptions: string[];
  steps: ParsedPlanStep[];
}

export interface PlanParseResult {
  ok: boolean;
  plan?: ParsedPlan;
  errors?: string[];
}

/**
 * Deterministically parse a plan.md string into a ParsedPlan.
 * No LLM calls. Returns errors array on any structural problem.
 */
export function parsePlan(markdown: string): PlanParseResult {
  const errors: string[] = [];
  const lines = markdown.split("\n");

  // ---- Extract title (first # heading) ----
  const titleLine = lines.find((l) => l.startsWith("# "));
  const title = titleLine ? titleLine.slice(2).trim() : "";
  if (!title) errors.push("Missing # title heading");

  // ---- Extract header sections ----
  function extractSection(heading: string): string[] {
    const startIdx = lines.findIndex((l) => l.trim() === `## ${heading}`);
    if (startIdx === -1) return [];
    const result: string[] = [];
    for (let i = startIdx + 1; i < lines.length; i++) {
      if (lines[i].startsWith("## ") || lines[i].startsWith("---")) break;
      const stripped = lines[i].replace(/^- /, "").trim();
      if (stripped) result.push(stripped);
    }
    return result;
  }

  const goalLines = extractSection("目标");
  const goal = goalLines.join(" ").trim();
  const constraints = extractSection("技术约束");
  const assumptions = extractSection("假设");

  // ---- Extract steps ----
  const steps: ParsedPlanStep[] = [];
  const stepHeadingRe = /^### step:\s*(.+)$/;

  let i = 0;
  while (i < lines.length) {
    const match = stepHeadingRe.exec(lines[i]);
    if (!match) { i++; continue; }

    const stepId = match[1].trim();
    const fields: Record<string, string> = {};
    i++;

    // Read field lines until next ### or end
    while (i < lines.length && !lines[i].startsWith("### ")) {
      const fieldMatch = /^- (\w+):\s*(.*)$/.exec(lines[i]);
      if (fieldMatch) {
        const key = fieldMatch[1];
        const val = fieldMatch[2].trim();
        if (val === "|") {
          // multiline value: collect indented lines
          const indentedLines: string[] = [];
          i++;
          while (i < lines.length && (lines[i].startsWith("    ") || lines[i] === "")) {
            indentedLines.push(lines[i].replace(/^    /, ""));
            i++;
          }
          fields[key] = indentedLines.join("\n").trim();
          continue;
        } else {
          fields[key] = val;
        }
      }
      i++;
    }

    // Parse depends array: "[a, b, c]" or "[]"
    let depends: string[] = [];
    if (fields.depends) {
      const inner = fields.depends.replace(/^\[/, "").replace(/\]$/, "").trim();
      depends = inner ? inner.split(",").map((s) => s.trim()).filter(Boolean) : [];
    }

    const checkpoint = fields.checkpoint?.toLowerCase() === "true";

    if (!fields.title) errors.push(`Step "${stepId}": missing title`);
    if (!fields.role) errors.push(`Step "${stepId}": missing role`);
    if (!fields.file && !checkpoint) errors.push(`Step "${stepId}": missing file`);
    if (!fields.task) errors.push(`Step "${stepId}": missing task`);

    steps.push({
      id: stepId,
      title: fields.title ?? "",
      role: fields.role ?? "implementer",
      file: fields.file ?? `output/${stepId}.md`,
      depends,
      checkpoint,
      task: fields.task ?? "",
      acceptance: fields.acceptance ?? "",
    });
  }

  if (steps.length === 0) errors.push("No steps found — missing '## 步骤' section or ### step: blocks");

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, plan: { title, goal, constraints, assumptions, steps } };
}

/**
 * Convert ParsedPlan into the shape validatePlanData expects,
 * then run semantic validation (duplicate ids, dependency cycles, etc.)
 */
export function validateParsedPlan(
  parsed: ParsedPlan,
  config: ShipyardConfig,
  strategy?: TaskStrategy
): string[] {
  // Build the PlannerPlan-shaped object validatePlanData expects
  const plannerPlan = {
    title: parsed.title,
    ambiguities: parsed.assumptions,
    steps: parsed.steps.map((s) => ({
      id: s.id,
      title: s.title,
      specFragment: s.task.slice(0, 100),
      nodeRole: s.role,
      task: s.task,
      acceptanceCriteria: s.acceptance,
      skills: [] as string[],
      description: s.task,
      outputFile: s.file,
      dependsOn: s.depends,
      role: s.checkpoint ? "checkpoint" : s.role,
    })),
  };

  return validatePlanData(plannerPlan, config, strategy);
}
```

- [ ] **Step 2: Export validatePlanData from planner.ts**

`validatePlanData` is currently not exported from `planner.ts`. Open `packages/core/src/orchestrator/planner.ts` and change:

```typescript
function validatePlanData(planData: PlannerPlan, config: ShipyardConfig, strategy?: TaskStrategy): string[] {
```

to:

```typescript
export function validatePlanData(planData: PlannerPlan, config: ShipyardConfig, strategy?: TaskStrategy): string[] {
```

- [ ] **Step 3: Typecheck**

```bash
cd /Users/cookie/project/shipyard && pnpm typecheck 2>&1 | tail -10
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/orchestrator/plan-parser.ts packages/core/src/orchestrator/planner.ts
git commit -m "feat: add plan-parser and export validatePlanData"
```

---

## Task 4: Export new modules from core index

**Files:**
- Modify: `packages/core/src/orchestrator/index.ts`

- [ ] **Step 1: Add exports**

Open `packages/core/src/orchestrator/index.ts` and add:

```typescript
export { generatePlan } from "./plan-generator";
export { parsePlan, validateParsedPlan } from "./plan-parser";
export type { ParsedPlan, ParsedPlanStep, PlanParseResult } from "./plan-parser";
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/cookie/project/shipyard && pnpm typecheck 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/orchestrator/index.ts
git commit -m "feat: export plan-generator and plan-parser from core"
```

---

## Task 5: Add shared types for Plan API

**Files:**
- Modify: `packages/shared/src/types.ts`

- [ ] **Step 1: Add PlanRequest, PlanResponse, PlanMessage; extend RunRequest with mode**

In `packages/shared/src/types.ts`:

1. Find `export interface RunRequest` and add `mode` field:

```typescript
export interface RunRequest {
  spec: string;
  repoPath?: string;
  strategyId?: string;
  mode?: "spec" | "plan";  // "spec" = LLM planning (default), "plan" = parse plan.md directly
  llm?: {
    baseURL?: string;
    apiKey?: string;
  };
}
```

2. After `PRDResponse`, add:

```typescript
// ---- Plan API ----

export interface PlanRequest {
  spec: string;
  llm?: {
    baseURL?: string;
    apiKey?: string;
  };
}

export interface PlanResponse {
  ok: boolean;
  plan?: string;   // raw plan.md text
  error?: string;
}
```

3. Find `PRDMessage` in execution types (it's in `apps/web/src/domains/execution/types.ts`, not shared — leave shared unchanged for now; we handle it in Task 8).

- [ ] **Step 2: Typecheck**

```bash
cd /Users/cookie/project/shipyard && pnpm typecheck 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types.ts
git commit -m "feat: add PlanRequest/PlanResponse types and mode to RunRequest"
```

---

## Task 6: Add POST /api/plan route

**Files:**
- Create: `apps/server/src/routes/plan.ts`
- Modify: `apps/server/src/index.ts`

- [ ] **Step 1: Create routes/plan.ts**

```typescript
// apps/server/src/routes/plan.ts
import { Router, Request, Response } from "express";
import { DEFAULT_CONFIG } from "../config";
import { generatePlan } from "../shipyard";
import type { PlanRequest, PlanResponse } from "../types";

export const planRouter = Router();

planRouter.post("/plan", async (req: Request, res: Response) => {
  const { spec, llm } = req.body as PlanRequest;

  if (!spec?.trim()) {
    res.status(400).json({ ok: false, error: "spec is required" } satisfies PlanResponse);
    return;
  }

  const workDir = process.env.WORK_DIR ?? process.cwd();
  const config = {
    ...DEFAULT_CONFIG,
    workDir,
    baseURL: llm?.baseURL?.trim() || DEFAULT_CONFIG.baseURL,
    apiKey: llm?.apiKey?.trim() || DEFAULT_CONFIG.apiKey,
  };

  try {
    const plan = await generatePlan(spec, config);
    res.json({ ok: true, plan } satisfies PlanResponse);
  } catch (error) {
    console.error("[shipyard:server:plan]", (error as Error).message);
    res.status(500).json({ ok: false, error: (error as Error).message } satisfies PlanResponse);
  }
});

// Deprecate /prd — redirect callers to /plan
planRouter.post("/prd", (_req: Request, res: Response) => {
  res.status(410).json({ deprecated: true, useInstead: "/api/plan" });
});
```

- [ ] **Step 2: Register planRouter and remove prdRouter in index.ts**

In `apps/server/src/index.ts`:

Replace:
```typescript
import { prdRouter } from "./routes/prd";
```
With:
```typescript
import { planRouter } from "./routes/plan";
```

Replace:
```typescript
app.use("/api", prdRouter);
```
With:
```typescript
app.use("/api", planRouter);
```

- [ ] **Step 3: Typecheck**

```bash
cd /Users/cookie/project/shipyard && pnpm typecheck 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/routes/plan.ts apps/server/src/index.ts
git commit -m "feat: add POST /api/plan route, deprecate /api/prd"
```

---

## Task 7: Extend /api/run to handle mode: "plan"

**Files:**
- Modify: `apps/server/src/routes/run.ts`

- [ ] **Step 1: Import parsePlan and validateParsedPlan**

At the top of `apps/server/src/routes/run.ts`, add to the existing shipyard import:

```typescript
import { run, detectStrategy, getStrategy, parsePlan, validateParsedPlan } from "../shipyard";
```

(Verify that `../shipyard` re-exports these — if not, import from `"@shipyard/core"` or the direct path.)

- [ ] **Step 2: Check re-export in apps/server/src/shipyard.ts**

Open `apps/server/src/shipyard.ts` (or wherever the server re-exports core). Add if missing:

```typescript
export { parsePlan, validateParsedPlan } from "@shipyard/core";
```

- [ ] **Step 3: Handle mode in runRouter.post("/run")**

In `apps/server/src/routes/run.ts`, find the `runRouter.post("/run", ...)` handler. After the `spec` validation block, add mode extraction:

```typescript
const { spec, repoPath, strategyId, llm, mode } = req.body as RunRequest;
```

Then in `runWithLegacy`, replace the `buildGraph` call path so that when `mode === "plan"`:

Find the call to `run(spec, config, ...)` and change the call to pass a pre-built graph when `mode === "plan"`:

```typescript
// In runWithLegacy, before calling run():
let initialGraph: import("../graph").ExecutionGraph | undefined;

if (mode === "plan") {
  const parseResult = parsePlan(spec);
  if (!parseResult.ok || !parseResult.plan) {
    sseManager.push({ type: "log", payload: `Plan parse failed: ${(parseResult.errors ?? []).join("; ")}`, projectId, sessionId });
    updateSession(workDir, projectId, sessionId, { status: "failed" });
    setSessionRunning(projectId, sessionId, false);
    sseManager.push({
      type: "graph_failed",
      payload: {
        id: sessionId, title: "", status: "failed", strategyId: strategy.id,
        stats: { total: 0, done: 0, failed: 0, filesGenerated: 0, verificationsPassed: 0, verificationsRun: 0 },
        durationMs: 0,
      } satisfies GraphSummary,
      projectId, sessionId,
    });
    return;
  }

  const validationErrors = validateParsedPlan(parseResult.plan, config, strategy);
  if (validationErrors.length > 0) {
    sseManager.push({ type: "log", payload: `Plan validation failed: ${validationErrors.join("; ")}`, projectId, sessionId });
    updateSession(workDir, projectId, sessionId, { status: "failed" });
    setSessionRunning(projectId, sessionId, false);
    sseManager.push({
      type: "graph_failed",
      payload: {
        id: sessionId, title: "", status: "failed", strategyId: strategy.id,
        stats: { total: 0, done: 0, failed: 0, filesGenerated: 0, verificationsPassed: 0, verificationsRun: 0 },
        durationMs: 0,
      } satisfies GraphSummary,
      projectId, sessionId,
    });
    return;
  }

  // Convert ParsedPlan → ExecutionGraph via buildGraph with the plan.md as spec
  // We pass the plan.md text as spec — buildGraph will call clarifySpec+planner UNLESS
  // we pass an initialGraph. Instead, use parsePlanToGraph helper.
  initialGraph = parsedPlanToGraph(parseResult.plan, config, strategy);
}
```

- [ ] **Step 4: Add parsedPlanToGraph helper in run.ts**

Add this function before `runWithLegacy`:

```typescript
import { createGraph, addNode } from "../graph";
import { validateParsedPlan, type ParsedPlan } from "../shipyard";

function parsedPlanToGraph(
  plan: ParsedPlan,
  config: ReturnType<typeof Object.assign>,
  strategy: ReturnType<typeof detectStrategy>
): import("../graph").ExecutionGraph {
  let graph = createGraph(plan.goal || plan.title);
  graph = { ...graph, title: plan.title };

  for (const step of plan.steps) {
    const isCheckpoint = step.checkpoint;
    graph = addNode(graph, {
      id: step.id,
      type: isCheckpoint ? "checkpoint" : "implement",
      title: step.title,
      specFragment: step.task.slice(0, 200),
      nodeRole: isCheckpoint ? "checkpoint" : step.role,
      task: step.task,
      acceptanceCriteria: step.acceptance ||
        `SCOPE: Review ONLY ${step.file}. Check: file compiles and implements "${step.title}".`,
      acceptance: undefined,
      skills: [],
      dependsOn: step.depends,
      inputs: { description: step.task },
      outputs: {
        description: isCheckpoint ? `Checkpoint: ${step.title}` : `Write ${step.file}`,
        files: isCheckpoint ? [] : [step.file],
        verificationCriteria: [],
      },
      status: step.depends.length === 0 ? "ready" : "pending",
      maxRetries: isCheckpoint ? 0 : config.maxRetries,
    });
  }

  return graph;
}
```

- [ ] **Step 5: Pass initialGraph to run()**

In `runWithLegacy`, find the `run(spec, config, undefined, ...)` call and replace `undefined` with `initialGraph`:

```typescript
const graph = await run(spec, config, initialGraph, (updatedGraph) => {
```

- [ ] **Step 6: Typecheck**

```bash
cd /Users/cookie/project/shipyard && pnpm typecheck 2>&1 | tail -10
```

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/routes/run.ts
git commit -m "feat: extend /api/run with mode=plan, skip LLM planning for structured plans"
```

---

## Task 8: Update shared/execution types — PRDMessage → PlanMessage

**Files:**
- Modify: `apps/web/src/domains/execution/types.ts`

- [ ] **Step 1: Rename PRDMessage to PlanMessage**

In `apps/web/src/domains/execution/types.ts`, find:

```typescript
export type PRDMessage = {
  role: "prd";
  prd: string;
  confirmed?: boolean;
};

export type ChatMessage = TextMessage | ClarificationMessage | PRDMessage;
```

Replace with:

```typescript
export type PlanMessage = {
  role: "plan";
  plan: string;
  confirmed?: boolean;
};

export type ChatMessage = TextMessage | ClarificationMessage | PlanMessage;
```

- [ ] **Step 2: Typecheck to find all call sites**

```bash
cd /Users/cookie/project/shipyard && pnpm typecheck 2>&1 | grep "prd\|PRD" | head -20
```

Fix all reported errors (role "prd" → "plan", `.prd` → `.plan`, `PRDMessage` → `PlanMessage`) across:
- `apps/web/src/features/chat/views/ChatMessageItem.tsx`
- `apps/web/src/features/chat/containers/ChatPanelContainer.tsx`
- `apps/web/src/features/task-creation/useTaskCreationFlow.ts` (partially — full rewrite in Task 10)

- [ ] **Step 3: Typecheck clean**

```bash
cd /Users/cookie/project/shipyard && pnpm typecheck 2>&1 | tail -5
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/domains/execution/types.ts apps/web/src/features/chat/views/ChatMessageItem.tsx apps/web/src/features/chat/containers/ChatPanelContainer.tsx
git commit -m "refactor: rename PRDMessage → PlanMessage, role prd → plan"
```

---

## Task 9: Update workspace types and store — pendingPRD → pendingPlan

**Files:**
- Modify: `apps/web/src/domains/workspace/types.ts`
- Modify: `apps/web/src/domains/workspace/store.ts`

- [ ] **Step 1: Update types.ts**

In `apps/web/src/domains/workspace/types.ts`:

Replace:
```typescript
export interface CreationPendingPRD {
  originalSpec: string;
}
```
With:
```typescript
export interface CreationPendingPlan {
  originalSpec: string;
}
```

Replace `"reviewing_prd"` in `CreationFlowStage`:
```typescript
export type CreationFlowStage = "idle" | "drafting" | "clarifying" | "reviewing_plan" | "starting_run";
```

In `CreationFlow` interface, replace `pendingPRD: CreationPendingPRD | null` with:
```typescript
pendingPlan: CreationPendingPlan | null;
```

- [ ] **Step 2: Update store.ts**

In `apps/web/src/domains/workspace/store.ts`:

1. Update import: `CreationPendingPRD` → `CreationPendingPlan`
2. Initial state: `pendingPRD: null` → `pendingPlan: null`
3. Action type: `setCreationPendingPRD: (pendingPRD: CreationPendingPRD | null) => void` → `setCreationPendingPlan: (pendingPlan: CreationPendingPlan | null) => void`
4. Implementation:
```typescript
setCreationPendingPlan: (pendingPlan) =>
  set((state) => ({
    workspace: { ...state.workspace, creationFlow: { ...state.workspace.creationFlow, pendingPlan } },
  })),
```

- [ ] **Step 3: Update selectors if needed**

```bash
grep -rn "pendingPRD\|reviewing_prd\|CreationPendingPRD" /Users/cookie/project/shipyard/apps/web/src/
```
Fix any remaining references.

- [ ] **Step 4: Typecheck**

```bash
cd /Users/cookie/project/shipyard && pnpm typecheck 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/domains/workspace/types.ts apps/web/src/domains/workspace/store.ts
git commit -m "refactor: rename pendingPRD → pendingPlan in workspace store"
```

---

## Task 10: Add planClient.ts and update useTaskCreationFlow

**Files:**
- Create: `apps/web/src/shared/api/planClient.ts`
- Modify: `apps/web/src/features/task-creation/useTaskCreationFlow.ts`

- [ ] **Step 1: Create planClient.ts**

```typescript
// apps/web/src/shared/api/planClient.ts
import { fetchJSON } from "../../utils/fetchJSON";
import { loadLLMSettings } from "./llmSettings";
import type { PlanRequest, PlanResponse } from "@shipyard/shared";

export async function generatePlan(spec: string): Promise<string> {
  const llm = loadLLMSettings();
  const data = await fetchJSON<PlanResponse>("/api/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ spec, llm } satisfies PlanRequest),
  });

  if (!data.ok || !data.plan) {
    throw new Error(data.error ?? "Plan generation failed");
  }

  return data.plan;
}
```

- [ ] **Step 2: Rewrite useTaskCreationFlow.ts**

Replace the entire file content:

```typescript
import { useCallback } from "react";
import { useExecutionStore } from "../../domains/execution/store";
import { useWorkspaceStore } from "../../domains/workspace/store";
import { selectCreationFlow } from "../../domains/workspace/selectors";
import { clarifySpec } from "../../shared/api/clarifyClient";
import { generatePlan } from "../../shared/api/planClient";
import { runSpec } from "../../shared/api/runClient";
import type { ActiveSession } from "../session/types";
import type { Message } from "../chat/types";
import type { PendingClarification } from "../../domains/workspace/types";

interface Args {
  onRunStarted?: (session: ActiveSession) => Promise<void> | void;
}

function appendClarifications(spec: string, questions: PendingClarification["questions"], answers: Record<string, string>) {
  const lines = questions.map((question, index) => {
    const answer = answers[question.id]?.trim() || "(not provided)";
    return `${index + 1}. ${question.text}\nAnswer: ${answer}`;
  });
  return `${spec}\n\n=== Clarifications ===\n${lines.join("\n\n")}`;
}

export function useTaskCreationFlow({ onRunStarted }: Args) {
  const creationFlow = useWorkspaceStore(selectCreationFlow);
  const setCreationInput = useWorkspaceStore((state) => state.setCreationInput);
  const setCreationStage = useWorkspaceStore((state) => state.setCreationStage);
  const setCreationMessages = useWorkspaceStore((state) => state.setCreationMessages);
  const appendCreationMessage = useWorkspaceStore((state) => state.appendCreationMessage);
  const setCreationPendingClarification = useWorkspaceStore((state) => state.setCreationPendingClarification);
  const setCreationPendingPlan = useWorkspaceStore((state) => state.setCreationPendingPlan);
  const resetCreationFlow = useWorkspaceStore((state) => state.resetCreationFlow);
  const setChatMessages = useExecutionStore((state) => state.setChatMessages);

  const pushMessage = useCallback((message: Message) => {
    appendCreationMessage(message);
  }, [appendCreationMessage]);

  const startRun = useCallback(async (plan: string, nextMessages: Message[]) => {
    try {
      setCreationStage("starting_run");
      const result = await runSpec({ spec: plan, mode: "plan" });
      if (!result.ok || !result.projectId || !result.sessionId) {
        return { ok: false as const, error: result.error ?? "Run failed" };
      }
      const session = { projectId: result.projectId, sessionId: result.sessionId };
      setChatMessages(session, nextMessages);
      resetCreationFlow();
      await onRunStarted?.(session);
      return { ok: true as const };
    } catch (error) {
      return { ok: false as const, error: (error as Error).message };
    }
  }, [onRunStarted, resetCreationFlow, setChatMessages, setCreationStage]);

  const generatePlanForSpec = useCallback(async (spec: string, baseMessages?: Message[]) => {
    try {
      const plan = await generatePlan(spec);
      setCreationMessages([
        ...(baseMessages ?? creationFlow.messages),
        { role: "ai", text: "I drafted an execution plan for this task. Review it below before starting." },
        { role: "plan", plan, confirmed: false },
      ]);
      setCreationPendingPlan({ originalSpec: spec });
      setCreationPendingClarification(null);
      setCreationStage("reviewing_plan");
    } catch (error) {
      const fallbackMessages = [
        ...(baseMessages ?? creationFlow.messages),
        { role: "system", text: "Plan generation failed, trying to start directly." } satisfies Message,
      ];
      setCreationMessages(fallbackMessages);
      const result = await startRun(spec, fallbackMessages);
      if (!result.ok) {
        appendCreationMessage({ role: "system", text: `Failed: ${result.error}` });
        setCreationStage("drafting");
      }
      if (error instanceof Error) {
        console.debug("[shipyard:task-creation] plan generation failed", error.message);
      }
    }
  }, [appendCreationMessage, creationFlow.messages, setCreationMessages, setCreationPendingClarification, setCreationPendingPlan, setCreationStage, startRun]);

  const send = useCallback(async () => {
    const text = creationFlow.input.trim();
    if (!text || creationFlow.stage === "starting_run" || creationFlow.pendingClarification || creationFlow.pendingPlan) return;

    const nextMessages = [...creationFlow.messages, { role: "user", text } satisfies Message];
    setCreationInput("");
    setCreationMessages(nextMessages);
    setCreationStage("drafting");

    try {
      const clarification = await clarifySpec(text);
      if (clarification.needsClarification && clarification.questions.length > 0) {
        setCreationMessages([
          ...nextMessages,
          { role: "ai", text: "Before I draft the plan, I need a few clarifications." },
        ]);
        setCreationPendingClarification({ baseSpec: text, questions: clarification.questions });
        setCreationPendingPlan(null);
        setCreationStage("clarifying");
        return;
      }
      await generatePlanForSpec(text, nextMessages);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const fallbackMessages = [
        ...nextMessages,
        { role: "system", text: `Clarification failed: ${message}. Continuing.` } satisfies Message,
      ];
      setCreationMessages(fallbackMessages);
      await generatePlanForSpec(text, fallbackMessages);
    }
  }, [creationFlow.input, creationFlow.messages, creationFlow.pendingClarification, creationFlow.pendingPlan, creationFlow.stage, generatePlanForSpec, setCreationInput, setCreationMessages, setCreationPendingClarification, setCreationPendingPlan, setCreationStage]);

  const confirmClarification = useCallback(async (answers: Record<string, string>) => {
    if (!creationFlow.pendingClarification || creationFlow.stage === "starting_run") return;
    const clarifiedSpec = appendClarifications(
      creationFlow.pendingClarification.baseSpec,
      creationFlow.pendingClarification.questions,
      answers
    );
    const nextMessages = [
      ...creationFlow.messages,
      { role: "clarification", questions: creationFlow.pendingClarification.questions, answered: true, answers } satisfies Message,
      { role: "ai", text: "Thanks — incorporated your answers. Drafting the plan now." } satisfies Message,
    ];
    setCreationMessages(nextMessages);
    setCreationPendingClarification(null);
    setCreationStage("drafting");
    await generatePlanForSpec(clarifiedSpec, nextMessages);
  }, [creationFlow.messages, creationFlow.pendingClarification, creationFlow.stage, generatePlanForSpec, setCreationMessages, setCreationPendingClarification, setCreationStage]);

  const skipClarification = useCallback(async () => {
    if (!creationFlow.pendingClarification || creationFlow.stage === "starting_run") return;
    const nextMessages = [
      ...creationFlow.messages,
      { role: "system", text: "Skipped clarification. Proceeding." } satisfies Message,
    ];
    const originalSpec = creationFlow.pendingClarification.baseSpec;
    setCreationMessages(nextMessages);
    setCreationPendingClarification(null);
    setCreationStage("drafting");
    await generatePlanForSpec(originalSpec, nextMessages);
  }, [creationFlow.messages, creationFlow.pendingClarification, creationFlow.stage, generatePlanForSpec, setCreationMessages, setCreationPendingClarification, setCreationStage]);

  const confirmPlan = useCallback(async (plan: string) => {
    if (!creationFlow.pendingPlan || creationFlow.stage === "starting_run") return;
    const currentPending = creationFlow.pendingPlan;
    const confirmedMessages = creationFlow.messages.map((message): Message =>
      message.role === "plan" && !message.confirmed ? { ...message, confirmed: true, plan } : message
    );
    setCreationPendingPlan(null);
    setCreationMessages(confirmedMessages);
    const result = await startRun(plan, confirmedMessages);
    if (!result.ok) {
      setCreationPendingPlan(currentPending);
      setCreationMessages(confirmedMessages.map((message): Message =>
        message.role === "plan" ? { ...message, confirmed: false, plan } : message
      ));
      pushMessage({ role: "system", text: `Failed: ${result.error}` });
      setCreationStage("reviewing_plan");
    }
  }, [creationFlow.messages, creationFlow.pendingPlan, creationFlow.stage, pushMessage, setCreationMessages, setCreationPendingPlan, setCreationStage, startRun]);

  const discardPlan = useCallback(async () => {
    if (!creationFlow.pendingPlan || creationFlow.stage === "starting_run") return;
    const currentPending = creationFlow.pendingPlan;
    const confirmedMessages = creationFlow.messages.map((message): Message =>
      message.role === "plan" && !message.confirmed ? { ...message, confirmed: true } : message
    );
    setCreationPendingPlan(null);
    setCreationMessages(confirmedMessages);
    const result = await startRun(currentPending.originalSpec, confirmedMessages);
    if (!result.ok) {
      setCreationPendingPlan(currentPending);
      setCreationMessages(confirmedMessages.map((message): Message =>
        message.role === "plan" ? { ...message, confirmed: false } : message
      ));
      pushMessage({ role: "system", text: `Failed: ${result.error}` });
      setCreationStage("reviewing_plan");
    }
  }, [creationFlow.messages, creationFlow.pendingPlan, creationFlow.stage, pushMessage, setCreationMessages, setCreationPendingPlan, setCreationStage, startRun]);

  const stageLabel = creationFlow.stage === "starting_run"
    ? "Starting run"
    : creationFlow.stage === "clarifying"
      ? "Need clarification"
      : creationFlow.stage === "reviewing_plan"
        ? "Review Plan"
        : creationFlow.stage === "drafting"
          ? "Refine task"
          : "Describe task";

  const composerDisabled = creationFlow.stage === "starting_run" || Boolean(creationFlow.pendingClarification) || Boolean(creationFlow.pendingPlan);
  const composerHint = creationFlow.pendingClarification
    ? "Answer the clarification card to continue."
    : creationFlow.pendingPlan
      ? "Review the plan and confirm before execution starts."
      : "Tip: use Ctrl/Cmd + Enter to submit.";

  return {
    input: creationFlow.input,
    loading: creationFlow.stage === "starting_run",
    messages: creationFlow.messages,
    pendingClarification: creationFlow.pendingClarification,
    pendingPlan: creationFlow.pendingPlan,
    stage: creationFlow.stage,
    stageLabel,
    composerDisabled,
    composerHint,
    setInput: setCreationInput,
    send,
    confirmClarification,
    skipClarification,
    confirmPlan,
    discardPlan,
  };
}
```

- [ ] **Step 3: Typecheck**

```bash
cd /Users/cookie/project/shipyard && pnpm typecheck 2>&1 | tail -10
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/shared/api/planClient.ts apps/web/src/features/task-creation/useTaskCreationFlow.ts
git commit -m "feat: wire generatePlan into task creation flow, replace PRD flow"
```

---

## Task 11: Add PlanEditorCard UI component (simple + expert mode)

**Files:**
- Create: `apps/web/src/features/task-creation/PlanEditorCard.tsx`
- Modify: `apps/web/src/features/chat/views/ChatMessageItem.tsx`

- [ ] **Step 1: Create PlanEditorCard.tsx**

```typescript
// apps/web/src/features/task-creation/PlanEditorCard.tsx
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/textarea";

interface StepSummary {
  id: string;
  title: string;
  checkpoint: boolean;
}

function parseStepTitles(plan: string): StepSummary[] {
  const steps: StepSummary[] = [];
  const lines = plan.split("\n");
  const headingRe = /^### step:\s*(.+)$/;
  for (let i = 0; i < lines.length; i++) {
    const m = headingRe.exec(lines[i]);
    if (!m) continue;
    const id = m[1].trim();
    let title = id;
    let checkpoint = false;
    for (let j = i + 1; j < lines.length && !lines[j].startsWith("### "); j++) {
      const tMatch = /^- title:\s*(.+)$/.exec(lines[j]);
      if (tMatch) title = tMatch[1].trim();
      const cpMatch = /^- checkpoint:\s*(.+)$/.exec(lines[j]);
      if (cpMatch) checkpoint = cpMatch[1].trim() === "true";
    }
    steps.push({ id, title, checkpoint });
  }
  return steps;
}

function parseGoal(plan: string): string {
  const lines = plan.split("\n");
  const goalIdx = lines.findIndex((l) => l.trim() === "## 目标");
  if (goalIdx === -1) return "";
  const goalLines: string[] = [];
  for (let i = goalIdx + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ") || lines[i].startsWith("---")) break;
    if (lines[i].trim()) goalLines.push(lines[i].trim());
  }
  return goalLines.join(" ");
}

interface Props {
  plan: string;
  onConfirm: (plan: string) => void;
  onDiscard: () => void;
}

export function PlanEditorCard({ plan, onConfirm, onDiscard }: Props) {
  const [value, setValue] = useState(plan);
  const [expertMode, setExpertMode] = useState(false);

  const goal = parseGoal(value);
  const steps = parseStepTitles(value);

  return (
    <div className="rounded-2xl border border-blue-200 overflow-hidden shadow-sm text-xs">
      <div className="bg-blue-50 border-b border-blue-200 px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold text-blue-800">
          <span>📋</span>
          <span>执行计划草稿 — 确认后开始执行</span>
        </div>
        <button
          type="button"
          onClick={() => setExpertMode((v) => !v)}
          className="text-[11px] text-blue-600 hover:underline"
        >
          {expertMode ? "简单视图" : "专家模式"}
        </button>
      </div>

      {expertMode ? (
        <div className="bg-white px-4 py-3">
          <p className="mb-2 text-[11px] text-gray-500">
            可直接编辑 Markdown。修改 <code>depends</code> 调整执行顺序，将 <code>checkpoint: false</code> 改为 <code>true</code> 可插入人工确认点。
          </p>
          <Textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="min-h-[400px] w-full resize-y rounded-lg bg-gray-50 p-3 text-xs font-mono shadow-none border-gray-200 leading-relaxed"
            spellCheck={false}
          />
        </div>
      ) : (
        <div className="bg-white px-4 py-3 space-y-3">
          {goal && (
            <div>
              <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">目标</div>
              <p className="text-xs text-gray-700 leading-relaxed">{goal}</p>
            </div>
          )}
          <div>
            <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">
              执行步骤 ({steps.length})
            </div>
            <ol className="space-y-1">
              {steps.map((step, idx) => (
                <li key={step.id} className="flex items-start gap-2 text-xs text-gray-700">
                  <span className="text-gray-400 w-4 flex-shrink-0">{idx + 1}.</span>
                  <span>{step.title}</span>
                  {step.checkpoint && (
                    <span className="ml-1 rounded bg-yellow-100 px-1 text-[10px] text-yellow-700">⏸ checkpoint</span>
                  )}
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}

      <div className="bg-blue-50 border-t border-blue-200 px-4 py-2.5 flex justify-end items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={onDiscard}
          className="h-auto rounded-lg px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-200 hover:text-gray-600"
        >
          放弃
        </Button>
        <Button
          type="button"
          onClick={() => onConfirm(value.trim())}
          disabled={!value.trim()}
          className="h-auto rounded-lg px-4 py-1.5 text-xs font-semibold"
        >
          确认并执行
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update ChatMessageItem.tsx to render PlanMessage**

In `apps/web/src/features/chat/views/ChatMessageItem.tsx`, find the block that renders `message.role === "prd"` and replace with:

```typescript
if (message.role === "plan") {
  return (
    <PlanEditorCard
      plan={message.plan}
      onConfirm={onPlanConfirm ?? (() => {})}
      onDiscard={onPlanDiscard ?? (() => {})}
    />
  );
}
```

Update the props interface to use `onPlanConfirm`/`onPlanDiscard` instead of `onPRDConfirm`/`onPRDDiscard`. Import `PlanEditorCard`.

- [ ] **Step 3: Typecheck**

```bash
cd /Users/cookie/project/shipyard && pnpm typecheck 2>&1 | tail -10
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/task-creation/PlanEditorCard.tsx apps/web/src/features/chat/views/ChatMessageItem.tsx
git commit -m "feat: add PlanEditorCard with simple/expert mode toggle"
```

---

## Task 12: Update TaskCreationView and Container

**Files:**
- Modify: `apps/web/src/features/task-creation/TaskCreationView.tsx`
- Modify: `apps/web/src/features/task-creation/TaskCreationContainer.tsx`

- [ ] **Step 1: Update TaskCreationView.tsx props**

Replace `onPRDConfirm`/`onPRDDiscard` with `onPlanConfirm`/`onPlanDiscard` throughout the file:

```typescript
onPlanConfirm: (plan: string) => void;
onPlanDiscard: () => void;
```

Update the `ChatMessageList` prop pass-through accordingly.

Also update the button label from "Draft PRD" to "Draft Plan":
```typescript
{loading ? "Working..." : "Draft Plan"}
```

And update the subtitle:
```typescript
Start from a rough idea, refine the scope, review the execution plan, and only then enter the execution canvas.
```

And the header badge from `PRD before canvas` to `Plan before canvas`.

- [ ] **Step 2: Update TaskCreationContainer.tsx**

Replace `onPRDConfirm={flow.confirmPRD}` / `onPRDDiscard={flow.discardPRD}` with:
```typescript
onPlanConfirm={flow.confirmPlan}
onPlanDiscard={flow.discardPlan}
```

- [ ] **Step 3: Update ChatMessageList props**

Find `ChatMessageList` and its props interface — rename `onPRDConfirm`/`onPRDDiscard` to `onPlanConfirm`/`onPlanDiscard`.

- [ ] **Step 4: Typecheck**

```bash
cd /Users/cookie/project/shipyard && pnpm typecheck 2>&1 | tail -5
```
Expected: no errors.

- [ ] **Step 5: Final full typecheck**

```bash
cd /Users/cookie/project/shipyard && pnpm typecheck 2>&1
```
Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/task-creation/TaskCreationView.tsx apps/web/src/features/task-creation/TaskCreationContainer.tsx
git commit -m "refactor: rename PRD → Plan in TaskCreation UI components"
```

---

## Task 13: Run runSpec with mode field

**Files:**
- Modify: `apps/web/src/shared/api/runClient.ts`

- [ ] **Step 1: Add mode to runSpec call**

Open `apps/web/src/shared/api/runClient.ts`. Find the `runSpec` function and update the type of its argument to include `mode`:

```typescript
export async function runSpec(params: { spec: string; mode?: "spec" | "plan"; repoPath?: string; strategyId?: string }): Promise<RunResponse> {
```

Ensure `mode` is included in the request body:
```typescript
body: JSON.stringify({ spec: params.spec, mode: params.mode, repoPath: params.repoPath, strategyId: params.strategyId, llm }),
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/cookie/project/shipyard && pnpm typecheck 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/shared/api/runClient.ts
git commit -m "feat: pass mode field through runClient to /api/run"
```

---

## Self-Review

**Spec coverage check:**
- ✅ plan.md format defined → Task 1 (PLAN_GENERATOR_PROMPT)
- ✅ plan-generator.ts → Task 2
- ✅ plan-parser.ts (deterministic) → Task 3
- ✅ validatePlanData exported → Task 3
- ✅ POST /api/plan → Task 6
- ✅ POST /api/prd → 410 deprecated → Task 6
- ✅ mode: "plan" in /api/run → Task 7
- ✅ plan.md persisted to session dir → Task 2
- ✅ PRDMessage → PlanMessage → Task 8
- ✅ pendingPRD → pendingPlan → Task 9
- ✅ useTaskCreationFlow rewired → Task 10
- ✅ PlanEditorCard (simple + expert mode) → Task 11
- ✅ mode toggle doesn't lose edited content → Task 11 (state in useState)
- ✅ TaskCreationView/Container prop rename → Task 12
- ✅ runClient passes mode → Task 13

**Type consistency check:**
- `PlanMessage.plan: string` used consistently in Tasks 8, 10, 11
- `confirmPlan(plan: string)` / `discardPlan()` defined in Task 10, wired in Task 12
- `parsedPlanToGraph` uses `ParsedPlan` from Task 3, called in Task 7
- `setCreationPendingPlan` defined in Task 9, used in Task 10

**No placeholders:** All code blocks are complete.
