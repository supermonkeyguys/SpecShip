/**
 * routes/run.ts — POST /run
 *
 * ORCHESTRATOR_MODE=legacy  (default) — 直接调用 core run()
 * ORCHESTRATOR_MODE=temporal          — 启动 Temporal SpecRunWorkflow
 */

import { Router, Request, Response } from "express";
import * as path from "path";
import { run, detectStrategy, getStrategy } from "../shipyard";
import { parsePlan, validateParsedPlan } from "../plan";
import type { ParsedPlan } from "../plan";
import { DEFAULT_CONFIG } from "../config";
import { sseManager } from "../sse";
import { watchSession, stopWatch } from "../sse-projection";
import { RunRequest, RunResponse, NodeStatus, GraphSummary } from "../types";
import { GraphNode, ExecutionGraph, createGraph, addNode } from "../graph";
import { mapGraphStatusToSessionStatus } from "../state";
import { getIsRunning, setSessionRunning } from "./resume";
import {
  createProject,
  createSession,
  getSessionOutputDir,
  updateSession,
} from "../project";
import {
  appendSessionOperation,
  getSessionRevision,
} from "../op-log";
import { injectViteScaffold } from "../preview-manager";

const pendingCheckpointResumes = new Map<string, { nodeId: string; resume: () => void }>();

function sessionKey(projectId: string, sessionId: string): string {
  return `${projectId}:${sessionId}`;
}

export function setPendingCheckpointResume(projectId: string, sessionId: string, nodeId: string, resume: () => void): void {
  pendingCheckpointResumes.set(sessionKey(projectId, sessionId), { nodeId, resume });
}

export function getPendingCheckpointResume(projectId: string, sessionId: string): { nodeId: string; resume: () => void } | null {
  return pendingCheckpointResumes.get(sessionKey(projectId, sessionId)) ?? null;
}

export function clearPendingCheckpointResume(projectId: string, sessionId: string): void {
  pendingCheckpointResumes.delete(sessionKey(projectId, sessionId));
}

export function hasPendingCheckpointResume(): boolean {
  return pendingCheckpointResumes.size > 0;
}

const ORCHESTRATOR_MODE = process.env.ORCHESTRATOR_MODE ?? "legacy";

export const runRouter = Router();

const DEBUG_PREFIX = "[shipyard:server:run]";

// 记录当前活跃的 session/workflow，供 SSE / resume / files 使用
export let activeSession: { projectId: string; sessionId: string } | null = null;
export let activeWorkflowId: string | null = null;

export function setActiveRunContext(
  session: { projectId: string; sessionId: string } | null,
  workflowId: string | null
): void {
  activeSession = session;
  activeWorkflowId = workflowId;
}

function appendShadowOperation(
  workDir: string,
  projectId: string,
  sessionId: string,
  source: "run" | "resume" | "retry" | "checkpoint" | "scheduler",
  type: "session.created" | "session.status_set" | "graph.initialized" | "node.status_set" | "node.evidence_appended" | "node.retry_scheduled" | "checkpoint.paused" | "checkpoint.resumed" | "graph.completed" | "graph.failed",
  payload: Record<string, unknown>,
  actor: "system" | "user" | "server" = "system"
): void {
  try {
    const revision = getSessionRevision(workDir, projectId, sessionId);
    appendSessionOperation(
      workDir,
      {
        v: 1,
        projectId,
        sessionId,
        actor,
        source,
        type,
        payload,
      },
      revision
    );
  } catch (e) {
    console.warn(`${DEBUG_PREFIX} shadow-op failed`, {
      projectId,
      sessionId,
      source,
      type,
      error: (e as Error).message,
    });
  }
}

function appendNodeOpsFromStatus(
  workDir: string,
  projectId: string,
  sessionId: string,
  node: GraphNode,
  source: "run" | "resume" | "retry" | "checkpoint" | "scheduler"
): void {
  appendShadowOperation(workDir, projectId, sessionId, source, "node.status_set", {
    nodeId: node.id,
    title: node.title,
    nodeType: node.type,
    specFragment: node.specFragment,
    dependsOn: node.dependsOn,
    status: node.status,
    retryCount: node.retryCount,
    maxRetries: node.maxRetries,
    error: node.error?.message,
    errorCategory: node.error?.category,
    errorRecoverable: node.error?.recoverable,
    durationMs: node.evidence?.durationMs,
  });

  if ((node.evidence?.filesWritten.length ?? 0) > 0 || (node.evidence?.toolCalls.length ?? 0) > 0 || (node.evidence?.verifications.length ?? 0) > 0) {
    appendShadowOperation(workDir, projectId, sessionId, source, "node.evidence_appended", {
      nodeId: node.id,
      filesWritten: node.evidence?.filesWritten.map((f) => f.path) ?? [],
      toolCalls: node.evidence?.toolCalls ?? [],
      verifications: node.evidence?.verifications ?? [],
    });
  }

  if (node.status === "ready" && node.retryCount > 0) {
    appendShadowOperation(workDir, projectId, sessionId, source, "node.retry_scheduled", {
      nodeId: node.id,
      retryCount: node.retryCount,
      maxRetries: node.maxRetries,
    });
  }
}

runRouter.post("/run", async (req: Request, res: Response) => {
  const { spec, repoPath, strategyId, llm, mode } = req.body as RunRequest;
  console.log(DEBUG_PREFIX, "request", { spec, repoPath, strategyId });

  if (!spec?.trim()) {
    res.status(400).json({ ok: false, error: "spec is required" } satisfies RunResponse);
    return;
  }

  if (getIsRunning() || hasPendingCheckpointResume()) {
    res.status(409).json({ ok: false, error: "A task is already running or paused awaiting resume" } satisfies RunResponse);
    return;
  }

  const workDir = process.env.WORK_DIR ?? process.cwd();

  const proj = createProject(workDir, spec.slice(0, 40), repoPath);
  const sess = createSession(workDir, proj.id, spec);

  appendShadowOperation(workDir, proj.id, sess.id, "run", "session.created", {
    spec,
    repoPath: repoPath ?? null,
    strategyId: strategyId ?? null,
  }, "server");
  appendShadowOperation(workDir, proj.id, sess.id, "run", "session.status_set", {
    status: "running",
  }, "server");

  const outputDir = path.relative(workDir, getSessionOutputDir(workDir, proj.id, sess.id));

  const config = {
    ...DEFAULT_CONFIG,
    workDir,
    repoPath: repoPath ?? undefined,
    projectId: proj.id,
    sessionId: sess.id,
    outputDir,
    baseURL: llm?.baseURL?.trim() || DEFAULT_CONFIG.baseURL,
    apiKey: llm?.apiKey?.trim() || DEFAULT_CONFIG.apiKey,
  };

  activeSession = { projectId: proj.id, sessionId: sess.id };
  sseManager.reset();

  // User override takes priority, otherwise auto-detect
  const strategy = strategyId ? (getStrategy(strategyId) ?? detectStrategy(spec)) : detectStrategy(spec);
  console.log(DEBUG_PREFIX, "accepted", { projectId: proj.id, sessionId: sess.id, outputDir, spec, strategyId: strategy.id });
  res.json({ ok: true, graphId: sess.id, projectId: proj.id, sessionId: sess.id, strategyId: strategy.id } satisfies RunResponse);

  if (ORCHESTRATOR_MODE === "temporal") {
    await runWithTemporal(spec, workDir, proj.id, sess.id, repoPath);
  } else {
    await runWithLegacy(spec, config, workDir, proj.id, sess.id, strategy, mode);
  }
});

function parsedPlanToGraph(
  plan: ParsedPlan,
  config: ReturnType<typeof Object.assign>,
  strategy: ReturnType<typeof detectStrategy>
): ExecutionGraph {
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

async function runWithLegacy(
  spec: string,
  config: ReturnType<typeof Object.assign>,
  workDir: string,
  projectId: string,
  sessionId: string,
  strategy: ReturnType<typeof detectStrategy>,
  mode?: "spec" | "plan"
): Promise<void> {
  setSessionRunning(projectId, sessionId, true);
  activeWorkflowId = null;
  const startTime = Date.now();
  const prevNodeStatus = new Map<string, string>();
  let graphInitialized = false;

  console.log(DEBUG_PREFIX, "runWithLegacy:start", { projectId, sessionId, spec: spec.slice(0, 80), strategy: strategy.id, config: { baseURL: config.baseURL, apiKey: config.apiKey ? config.apiKey.slice(0, 8) + "..." : "(empty)", model: config.models?.planning } });

  sseManager.push({ type: "log", payload: `Using strategy: ${strategy.name}`, projectId, sessionId });

  // For react-app strategy, inject vite.config.ts and index.html before AI execution
  // so AI nodes never need to write these infra files.
  if (strategy.id === "react-app") {
    const absOutputDir = path.join(workDir, config.outputDir);
    injectViteScaffold(absOutputDir);
  }

  let initialGraph: ExecutionGraph | undefined;

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

    let effectiveStrategy = strategy;
    let validationErrors = validateParsedPlan(parseResult.plan, config, effectiveStrategy);
    if (validationErrors.length > 0) {
      // Strategy mismatch: re-detect from plan file extensions rather than failing
      const extensions = parseResult.plan.steps
        .filter((s) => !s.checkpoint && s.file)
        .map((s) => path.extname(s.file))
        .filter(Boolean);
      const hasTs = extensions.some((e) => e === ".ts" || e === ".tsx");
      const hasJsx = extensions.some((e) => e === ".tsx" || e === ".jsx");
      if (hasTs || hasJsx) {
        const fallback = getStrategy("react-app") ?? getStrategy("typescript-lib") ?? effectiveStrategy;
        const retryErrors = validateParsedPlan(parseResult.plan, config, fallback);
        if (retryErrors.length === 0) {
          effectiveStrategy = fallback;
          validationErrors = [];
          console.log(DEBUG_PREFIX, "strategy:fallback", { from: strategy.id, to: fallback.id });
        }
      }
    }
    if (validationErrors.length > 0) {
      sseManager.push({ type: "log", payload: `Plan validation failed: ${validationErrors.join("; ")}`, projectId, sessionId });
      updateSession(workDir, projectId, sessionId, { status: "failed" });
      setSessionRunning(projectId, sessionId, false);
      sseManager.push({
        type: "graph_failed",
        payload: {
          id: sessionId, title: "", status: "failed", strategyId: effectiveStrategy.id,
          stats: { total: 0, done: 0, failed: 0, filesGenerated: 0, verificationsPassed: 0, verificationsRun: 0 },
          durationMs: 0,
        } satisfies GraphSummary,
        projectId, sessionId,
      });
      return;
    }

    initialGraph = parsedPlanToGraph(parseResult.plan, config, effectiveStrategy);
    strategy = effectiveStrategy;
  }

  try {
    const graph = await run(spec, config, initialGraph, (updatedGraph: import("../graph").ExecutionGraph) => {
      if (!graphInitialized) {
        appendShadowOperation(workDir, projectId, sessionId, "scheduler", "graph.initialized", {
          graphId: updatedGraph.id,
          title: updatedGraph.title,
          status: updatedGraph.status,
        });
        graphInitialized = true;
      }

      for (const node of updatedGraph.nodes.values()) {
        const prev = prevNodeStatus.get(node.id);
        const statusChanged = prev !== node.status;
        const hasLiveToolCalls = node.status === "running" && (node.evidence?.toolCalls.length ?? 0) > 0;
        if (statusChanged || hasLiveToolCalls) {
          if (statusChanged) {
            prevNodeStatus.set(node.id, node.status);
            appendNodeOpsFromStatus(workDir, projectId, sessionId, node, "scheduler");
          } else if (hasLiveToolCalls) {
            appendShadowOperation(workDir, projectId, sessionId, "scheduler", "node.evidence_appended", {
              nodeId: node.id,
              filesWritten: node.evidence?.filesWritten.map((f) => f.path) ?? [],
              toolCalls: node.evidence?.toolCalls ?? [],
              verifications: node.evidence?.verifications ?? [],
            });
          }

          sseManager.push({ type: "node_update", payload: toNodeStatus(node), projectId, sessionId });
        }
      }
    }, undefined, undefined, (checkpointNode, resume) => {
      setPendingCheckpointResume(projectId, sessionId, checkpointNode.id, resume);
      updateSession(workDir, projectId, sessionId, { status: "paused" });
      appendShadowOperation(workDir, projectId, sessionId, "checkpoint", "checkpoint.paused", {
        nodeId: checkpointNode.id,
        title: checkpointNode.title,
      });
      appendShadowOperation(workDir, projectId, sessionId, "checkpoint", "session.status_set", {
        status: "paused",
      });
      setSessionRunning(projectId, sessionId, false);
      sseManager.push({
        type: "log",
        payload: `Paused at checkpoint ${checkpointNode.id}: ${checkpointNode.title}`,
        projectId,
        sessionId,
      });
    }, undefined, strategy);

    clearPendingCheckpointResume(projectId, sessionId);
    const finalSessionStatus = mapGraphStatusToSessionStatus(graph.status);
    updateSession(workDir, projectId, sessionId, {
      status: finalSessionStatus,
    });
    appendShadowOperation(workDir, projectId, sessionId, "scheduler", "session.status_set", {
      status: finalSessionStatus,
    });
    appendShadowOperation(workDir, projectId, sessionId, "scheduler", graph.status === "done" ? "graph.completed" : "graph.failed", {
      graphId: graph.id,
      title: graph.title,
      status: graph.status,
    });

    const summary: GraphSummary = {
      id: graph.id,
      title: graph.title,
      status: graph.status === "done" ? "done" : "failed",
      strategyId: strategy.id,
      stats: {
        total: graph.stats.total,
        done: graph.stats.byStatus.done,
        failed: graph.stats.byStatus.failed,
        filesGenerated: graph.stats.filesGenerated,
        verificationsPassed: graph.stats.verificationsPassed,
        verificationsRun: graph.stats.verificationsRun,
      },
      durationMs: Date.now() - startTime,
    };

    sseManager.push({
      type: graph.status === "done" ? "graph_done" : "graph_failed",
      payload: summary,
      projectId,
      sessionId,
    });
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    clearPendingCheckpointResume(projectId, sessionId);
    updateSession(workDir, projectId, sessionId, { status: "failed" });
    appendShadowOperation(workDir, projectId, sessionId, "scheduler", "session.status_set", {
      status: "failed",
    });
    appendShadowOperation(workDir, projectId, sessionId, "scheduler", "graph.failed", {
      error: msg,
    });
    sseManager.push({ type: "log", payload: `Fatal error: ${msg}`, projectId, sessionId });

    try {
      const graphPath = require("../project").getSessionGraphPath(workDir, projectId, sessionId);
      const stuckGraph = require("../checkpoint").loadGraphCheckpoint(workDir, graphPath);
      let patched = stuckGraph;
      for (const node of stuckGraph.nodes.values()) {
        if (node.status === "running" || node.status === "verifying") {
          patched = require("../graph").transitionNode(patched, node.id, "failed", {
            error: { message: `Process died: ${msg}`, category: "unknown", recoverable: true },
          });
          sseManager.push({ type: "node_update", payload: toNodeStatus(patched.nodes.get(node.id)!), projectId, sessionId });
        }
      }
      require("../checkpoint").saveGraphCheckpoint(workDir, patched, graphPath);
    } catch { /* best-effort */ }

    sseManager.push({
      type: "graph_failed",
      payload: {
        id: sessionId,
        title: "",
        status: "failed",
        strategyId: strategy.id,
        stats: { total: 0, done: 0, failed: 0, filesGenerated: 0, verificationsPassed: 0, verificationsRun: 0 },
        durationMs: Date.now() - startTime,
      } satisfies GraphSummary,
      projectId,
      sessionId,
    });
  } finally {
    if (!getPendingCheckpointResume(projectId, sessionId)) {
      setSessionRunning(projectId, sessionId, false);
    }
  }
}

async function runWithTemporal(
  spec: string,
  workDir: string,
  projectId: string,
  sessionId: string,
  repoPath?: string
): Promise<void> {
  setSessionRunning(projectId, sessionId, true);

  watchSession(workDir, projectId, sessionId);

  try {
    const { startSpecRunWorkflow, buildWorkflowId } = await import("@shipyard/orchestrator-temporal") as typeof import("@shipyard/orchestrator-temporal");

    const workflowId = buildWorkflowId(projectId, sessionId);
    activeWorkflowId = workflowId;

    appendShadowOperation(workDir, projectId, sessionId, "run", "graph.initialized", {
      graphId: workflowId,
      title: spec.slice(0, 60),
      status: "running",
    });

    const summary = await startSpecRunWorkflow({ spec, projectId, sessionId, workDir, repoPath });

    const status = summary.status === "done" ? "done" : "failed";
    updateSession(workDir, projectId, sessionId, { status });
    appendShadowOperation(workDir, projectId, sessionId, "scheduler", "session.status_set", { status });
    appendShadowOperation(workDir, projectId, sessionId, "scheduler", summary.status === "done" ? "graph.completed" : "graph.failed", {
      graphId: workflowId,
      title: spec.slice(0, 60),
      status: summary.status,
    });

    sseManager.push({
      type: summary.status === "done" ? "graph_done" : "graph_failed",
      projectId,
      sessionId,
      payload: {
        id: workflowId,
        title: spec.slice(0, 60),
        status: summary.status === "done" ? "done" : "failed",
        stats: {
          total: Object.keys(summary.nodeStatuses).length,
          done: Object.values(summary.nodeStatuses).filter((s) => s === "done").length,
          failed: Object.values(summary.nodeStatuses).filter((s) => s === "failed").length,
          filesGenerated: 0,
          verificationsPassed: 0,
          verificationsRun: 0,
        },
        durationMs: 0,
      } satisfies GraphSummary,
    });
  } catch (e) {
    updateSession(workDir, projectId, sessionId, { status: "failed" });
    appendShadowOperation(workDir, projectId, sessionId, "scheduler", "session.status_set", { status: "failed" });
    appendShadowOperation(workDir, projectId, sessionId, "scheduler", "graph.failed", { error: (e as Error).message });
    sseManager.push({ type: "log", payload: `Temporal error: ${(e as Error).message}`, projectId, sessionId });
  } finally {
    stopWatch();
    setSessionRunning(projectId, sessionId, false);
  }
}

export function toNodeStatus(node: GraphNode): NodeStatus {
  return {
    id: node.id,
    title: node.title,
    status: node.status,
    nodeType: node.type,
    nodeRole: node.nodeRole,
    task: node.task,
    acceptanceCriteria: node.acceptanceCriteria,
    specFragment: node.specFragment,
    dependsOn: node.dependsOn,
    filesWritten: node.evidence?.filesWritten.map((f) => f.path) ?? [],
    toolCalls: node.evidence?.toolCalls.map((t) => ({
      tool: t.tool,
      input: t.input,
      output: t.output,
      success: t.success,
      timestamp: t.timestamp,
    })) ?? [],
    verifications: node.evidence?.verifications.map((v) => ({
      type: v.type,
      passed: v.passed,
      summary: v.output.slice(0, 100),
    })) ?? [],
    retryCount: node.retryCount,
    maxRetries: node.maxRetries,
    promptUsed: node.evidence?.promptUsed,
    error: node.error?.message,
    errorCategory: node.error?.category,
    errorRecoverable: node.error?.recoverable,
    durationMs: node.evidence?.durationMs,
  };
}
