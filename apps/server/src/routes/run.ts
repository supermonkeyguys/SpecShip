/**
 * routes/run.ts — POST /run
 *
 * ORCHESTRATOR_MODE=legacy  (default) — 直接调用 core run()
 * ORCHESTRATOR_MODE=temporal          — 启动 Temporal SpecRunWorkflow
 */

import { Router, Request, Response } from "express";
import * as path from "path";
import { run } from "../shipyard";
import { DEFAULT_CONFIG } from "../config";
import { sseManager } from "../sse";
import { watchSession, stopWatch } from "../sse-projection";
import { RunRequest, RunResponse, NodeStatus, GraphSummary } from "../types";
import { GraphNode } from "../graph";
import { mapGraphStatusToSessionStatus } from "../state";
import { getIsRunning, setIsRunning } from "./resume";
import {
  createProject, createSession, updateSession,
  getSessionOutputDir,
} from "../project";

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


runRouter.post("/run", async (req: Request, res: Response) => {
  const { spec, repoPath } = req.body as RunRequest;
  console.log(DEBUG_PREFIX, "request", { spec, repoPath });

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

  const outputDir = path.relative(workDir, getSessionOutputDir(workDir, proj.id, sess.id));

  const config = {
    ...DEFAULT_CONFIG,
    workDir,
    repoPath: repoPath ?? undefined,
    projectId: proj.id,
    sessionId: sess.id,
    outputDir,
  };

  activeSession = { projectId: proj.id, sessionId: sess.id };
  sseManager.reset();

  console.log(DEBUG_PREFIX, "accepted", { projectId: proj.id, sessionId: sess.id, outputDir, spec });
  res.json({ ok: true, graphId: sess.id, projectId: proj.id, sessionId: sess.id } satisfies RunResponse);

  if (ORCHESTRATOR_MODE === "temporal") {
    await runWithTemporal(spec, workDir, proj.id, sess.id, repoPath);
  } else {
    await runWithLegacy(spec, config, workDir, proj.id, sess.id);
  }
});

async function runWithLegacy(
  spec: string,
  config: ReturnType<typeof Object.assign>,
  workDir: string,
  projectId: string,
  sessionId: string
): Promise<void> {
  setIsRunning(true);
  activeWorkflowId = null;
  const startTime = Date.now();
  const prevNodeStatus = new Map<string, string>();

  console.log(DEBUG_PREFIX, "runWithLegacy:start", { projectId, sessionId, spec: spec.slice(0, 80), config: { baseURL: config.baseURL, apiKey: config.apiKey ? config.apiKey.slice(0, 8) + "..." : "(empty)", model: config.models?.planning } });

  try {
    const graph = await run(spec, config, undefined, (updatedGraph: import("../graph").ExecutionGraph) => {
      for (const node of updatedGraph.nodes.values()) {
        const prev = prevNodeStatus.get(node.id);
        const statusChanged = prev !== node.status;
        // tool call 进度推送：running 节点有 evidence.toolCalls 时也推
        const hasLiveToolCalls = node.status === "running" && (node.evidence?.toolCalls.length ?? 0) > 0;
        if (statusChanged || hasLiveToolCalls) {
          if (statusChanged) prevNodeStatus.set(node.id, node.status);
          sseManager.push({ type: "node_update", payload: toNodeStatus(node), projectId, sessionId });
        }
      }
    }, undefined, undefined, (checkpointNode, resume) => {
      setPendingCheckpointResume(projectId, sessionId, checkpointNode.id, resume);
      updateSession(workDir, projectId, sessionId, { status: "paused" });
      setIsRunning(false);
      sseManager.push({
        type: "log",
        payload: `Paused at checkpoint ${checkpointNode.id}: ${checkpointNode.title}`,
        projectId,
        sessionId,
      });
    });

    clearPendingCheckpointResume(projectId, sessionId);
    updateSession(workDir, projectId, sessionId, {
      status: mapGraphStatusToSessionStatus(graph.status),
    });

    const summary: GraphSummary = {
      id: graph.id,
      title: graph.title,
      status: graph.status === "done" ? "done" : "failed",
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
    sseManager.push({ type: "log", payload: `Fatal error: ${msg}`, projectId, sessionId });

    // 把所有还卡在 running/verifying 的节点标为 failed，推 node_update
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
        stats: { total: 0, done: 0, failed: 0, filesGenerated: 0, verificationsPassed: 0, verificationsRun: 0 },
        durationMs: Date.now() - startTime,
      } satisfies GraphSummary,
      projectId,
      sessionId,
    });
  } finally {
    if (!getPendingCheckpointResume(projectId, sessionId)) {
      setIsRunning(false);
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
  setIsRunning(true);

  watchSession(workDir, projectId, sessionId);

  try {
    const { startSpecRunWorkflow, buildWorkflowId } = await import("@shipyard/orchestrator-temporal") as typeof import("@shipyard/orchestrator-temporal");

    const workflowId = buildWorkflowId(projectId, sessionId);
    activeWorkflowId = workflowId;

    const summary = await startSpecRunWorkflow({ spec, projectId, sessionId, workDir, repoPath });

    updateSession(workDir, projectId, sessionId, {
      status: summary.status === "done" ? "done" : "failed",
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
    sseManager.push({ type: "log", payload: `Temporal error: ${(e as Error).message}`, projectId, sessionId });
  } finally {
    stopWatch();
    setIsRunning(false);
  }
}

export function toNodeStatus(node: GraphNode): NodeStatus {
  return {
    id: node.id,
    title: node.title,
    status: node.status,
    nodeType: node.type,
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
    error: node.error?.message,
    errorCategory: node.error?.category,
    errorRecoverable: node.error?.recoverable,
    durationMs: node.evidence?.durationMs,
  };
}
