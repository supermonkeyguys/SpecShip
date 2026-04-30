/**
 * routes/resume.ts
 *
 * GET  /api/status  — 查询是否有可恢复任务（优先基于显式 session）
 * POST /api/resume  — 从指定 session 断点恢复执行
 */

import { Router, Request, Response } from "express";
import { run } from "../shipyard";
import { DEFAULT_CONFIG } from "../config";
import { loadGraphCheckpoint, prepareGraphForResume, saveGraphCheckpoint } from "../checkpoint";
import { sseManager } from "../sse";
import { GraphNode } from "../graph";
import { mapGraphStatusToSessionStatus } from "../state";
import { watchSession, stopWatch } from "../sse-projection";
import { NodeStatus, GraphSummary, StatusResponse, ResumeResponse } from "../types";
import {
  activeSession, activeWorkflowId, setActiveRunContext,
  getPendingCheckpointResume, clearPendingCheckpointResume, setPendingCheckpointResume,
} from "./run";
import { getSessionGraphPath, listProjects, listSessions, getSessionOutputDir, updateSession } from "../project";

const ORCHESTRATOR_MODE = process.env.ORCHESTRATOR_MODE ?? "legacy";

export const resumeRouter = Router();

let isRunning = false;

export function setIsRunning(v: boolean) { isRunning = v; }
export function getIsRunning() { return isRunning; }

function resolveResumeTarget(workDir: string, projectId?: string, sessionId?: string) {
  if (projectId && sessionId) {
    return { projectId, sessionId, graphPath: getSessionGraphPath(workDir, projectId, sessionId) };
  }

  if (activeSession?.projectId && activeSession?.sessionId) {
    return {
      projectId: activeSession.projectId,
      sessionId: activeSession.sessionId,
      graphPath: getSessionGraphPath(workDir, activeSession.projectId, activeSession.sessionId),
    };
  }

  const projects = listProjects(workDir);
  for (const p of projects) {
    const sessions = listSessions(workDir, p.id);
    const candidate = sessions.find((s) => s.status === "running" || s.status === "paused" || s.status === "interrupted");
    if (candidate) {
      return {
        projectId: p.id,
        sessionId: candidate.id,
        graphPath: getSessionGraphPath(workDir, p.id, candidate.id),
      };
    }
  }

  return null;
}

resumeRouter.get("/status", async (req: Request, res: Response) => {
  const { projectId, sessionId } = req.query as { projectId?: string; sessionId?: string };

  if (ORCHESTRATOR_MODE === "temporal" && activeSession && activeWorkflowId) {
    try {
      const { querySpecRunSummary } = await import("@shipyard/orchestrator-temporal") as typeof import("@shipyard/orchestrator-temporal");
      const summary = await querySpecRunSummary({ workflowId: activeWorkflowId });
      const statuses = Object.values(summary.nodeStatuses);
      const doneCount = statuses.filter((s) => s === "done").length;
      const hasUnfinished = summary.status === "running";

      res.json({
        isRunning: isRunning || hasUnfinished,
        canResume: hasUnfinished && !isRunning,
        nodeCount: statuses.length,
        doneCount,
        projectId: activeSession.projectId,
        sessionId: activeSession.sessionId,
      } satisfies StatusResponse);
      return;
    } catch {
      res.json({
        isRunning,
        canResume: false,
        projectId: activeSession.projectId,
        sessionId: activeSession.sessionId,
      } satisfies StatusResponse);
      return;
    }
  }

  try {
    const workDir = process.env.WORK_DIR ?? process.cwd();
    const target = resolveResumeTarget(workDir, projectId, sessionId);

    if (!target) {
      res.json({
        isRunning,
        canResume: false,
        projectId: activeSession?.projectId,
        sessionId: activeSession?.sessionId,
      } satisfies StatusResponse);
      return;
    }

    const graph = loadGraphCheckpoint(workDir, target.graphPath);
    const doneCount = graph.stats.byStatus.done;
    const total = graph.stats.total;
    const hasUnfinished = graph.status !== "done" && graph.status !== "failed";

    res.json({
      isRunning,
      canResume: hasUnfinished && !isRunning,
      spec: graph.originalSpec,
      nodeCount: total,
      doneCount,
      projectId: target.projectId,
      sessionId: target.sessionId,
    } satisfies StatusResponse);
  } catch {
    res.json({
      isRunning,
      canResume: false,
      projectId: activeSession?.projectId,
      sessionId: activeSession?.sessionId,
    } satisfies StatusResponse);
  }
});

resumeRouter.post("/resume", async (req: Request, res: Response) => {
  if (isRunning) {
    res.status(409).json({ ok: false, error: "A task is already running" } satisfies ResumeResponse);
    return;
  }

  const { projectId: requestedProjectId, sessionId: requestedSessionId } = req.body as {
    projectId?: string;
    sessionId?: string;
  };

  const workDir = process.env.WORK_DIR ?? process.cwd();

  if (ORCHESTRATOR_MODE === "temporal") {
    const projectId = requestedProjectId ?? activeSession?.projectId;
    const sessionId = requestedSessionId ?? activeSession?.sessionId;

    if (!projectId || !sessionId) {
      res.status(400).json({ ok: false, error: "projectId/sessionId required for Temporal resume" } satisfies ResumeResponse);
      return;
    }

    const workflowId = activeWorkflowId ?? `specship:${projectId}:${sessionId}`;

    try {
      const { querySpecRunSummary, signalResumeRun, buildWorkflowId } = await import("@shipyard/orchestrator-temporal") as typeof import("@shipyard/orchestrator-temporal");
      const resolvedWorkflowId = activeWorkflowId ?? buildWorkflowId(projectId, sessionId);
      const summary = await querySpecRunSummary({ workflowId: resolvedWorkflowId });

      if (summary.status !== "running") {
        res.status(400).json({ ok: false, error: `Workflow is not running (status: ${summary.status})` } satisfies ResumeResponse);
        return;
      }

      await signalResumeRun({ workflowId: resolvedWorkflowId, reason: "resume via /api/resume" });

      setActiveRunContext({ projectId, sessionId }, resolvedWorkflowId);
      stopWatch();
      watchSession(workDir, projectId, sessionId);
      sseManager.reset();

      res.json({ ok: true, graphId: workflowId, projectId, sessionId } satisfies ResumeResponse);
      return;
    } catch (e) {
      res.status(500).json({ ok: false, error: `Temporal resume failed: ${(e as Error).message}` } satisfies ResumeResponse);
      return;
    }
  }

  const target = resolveResumeTarget(workDir, requestedProjectId, requestedSessionId);
  if (!target) {
    res.status(400).json({ ok: false, error: "No resumable session found" } satisfies ResumeResponse);
    return;
  }

  const config = {
    ...DEFAULT_CONFIG,
    workDir,
    projectId: target.projectId,
    sessionId: target.sessionId,
    outputDir: getSessionOutputDir(workDir, target.projectId, target.sessionId),
  };

  const pendingCheckpoint = getPendingCheckpointResume(target.projectId, target.sessionId);
  if (pendingCheckpoint) {
    clearPendingCheckpointResume(target.projectId, target.sessionId);
    updateSession(workDir, target.projectId, target.sessionId, { status: "running" });
    isRunning = true;
    res.json({ ok: true, graphId: target.sessionId, projectId: target.projectId, sessionId: target.sessionId } satisfies ResumeResponse);
    pendingCheckpoint.resume();
    return;
  }

  let graph;
  let autoApproveResumedCheckpoint = false;
  try {
    const loaded = loadGraphCheckpoint(config.workDir, target.graphPath);
    autoApproveResumedCheckpoint = loaded.status === "paused";
    graph = prepareGraphForResume(loaded);
    saveGraphCheckpoint(config.workDir, graph, target.graphPath);
  } catch (e) {
    res.status(400).json({ ok: false, error: `No checkpoint to resume: ${(e as Error).message}` } satisfies ResumeResponse);
    return;
  }

  sseManager.reset();
  res.json({
    ok: true,
    graphId: graph.id,
    projectId: target.projectId,
    sessionId: target.sessionId,
  } satisfies ResumeResponse);

  isRunning = true;
  updateSession(workDir, target.projectId, target.sessionId, { status: "running" });
  const startTime = Date.now();
  const prevNodeStatus = new Map<string, string>();

  try {
    const finalGraph = await run(graph.originalSpec, config, graph, (updatedGraph) => {
      for (const node of updatedGraph.nodes.values()) {
        const prev = prevNodeStatus.get(node.id);
        const statusChanged = prev !== node.status;
        const hasLiveToolCalls = node.status === "running" && (node.evidence?.toolCalls.length ?? 0) > 0;
        if (statusChanged || hasLiveToolCalls) {
          if (statusChanged) prevNodeStatus.set(node.id, node.status);
          sseManager.push({
            type: "node_update",
            payload: toNodeStatus(node),
            projectId: target.projectId,
            sessionId: target.sessionId,
          });
        }
      }
    }, undefined, undefined, (checkpointNode, resume) => {
      if (autoApproveResumedCheckpoint) {
        autoApproveResumedCheckpoint = false;
        resume();
        return;
      }
      setPendingCheckpointResume(target.projectId, target.sessionId, checkpointNode.id, resume);
      updateSession(workDir, target.projectId, target.sessionId, { status: "paused" });
      isRunning = false;
      sseManager.push({
        type: "log",
        payload: `Paused at checkpoint ${checkpointNode.id}: ${checkpointNode.title}`,
        projectId: target.projectId,
        sessionId: target.sessionId,
      });
    });

    clearPendingCheckpointResume(target.projectId, target.sessionId);
    updateSession(workDir, target.projectId, target.sessionId, {
      status: mapGraphStatusToSessionStatus(finalGraph.status),
    });


    const summary: GraphSummary = {
      id: finalGraph.id,
      title: finalGraph.title,
      status: finalGraph.status === "done" ? "done" : "failed",
      stats: {
        total: finalGraph.stats.total,
        done: finalGraph.stats.byStatus.done,
        failed: finalGraph.stats.byStatus.failed,
        filesGenerated: finalGraph.stats.filesGenerated,
        verificationsPassed: finalGraph.stats.verificationsPassed,
        verificationsRun: finalGraph.stats.verificationsRun,
      },
      durationMs: Date.now() - startTime,
    };

    sseManager.push({
      type: finalGraph.status === "done" ? "graph_done" : "graph_failed",
      payload: summary,
      projectId: target.projectId,
      sessionId: target.sessionId,
    });
  } catch (e) {
    clearPendingCheckpointResume(target.projectId, target.sessionId);
    updateSession(workDir, target.projectId, target.sessionId, { status: "failed" });
    sseManager.push({
      type: "log",
      payload: `Fatal error: ${(e as Error).message}`,
      projectId: target.projectId,
      sessionId: target.sessionId,
    });
  } finally {
    if (!getPendingCheckpointResume(target.projectId, target.sessionId)) {
      isRunning = false;
    }
  }
});

function toNodeStatus(node: GraphNode): NodeStatus {
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

// ---- 可复用的 resume 执行函数（供 node retry 调用）----

export async function runResumeSession(
  projectId: string,
  sessionId: string,
): Promise<void> {
  if (isRunning) return; // 已有任务在跑，忽略

  const workDir = process.env.WORK_DIR ?? process.cwd();
  const graphPath = getSessionGraphPath(workDir, projectId, sessionId);

  let graph;
  let autoApproveResumedCheckpoint = false;
  try {
    const loaded = loadGraphCheckpoint(workDir, graphPath);
    autoApproveResumedCheckpoint = loaded.status === "paused";
    graph = prepareGraphForResume(loaded);
    saveGraphCheckpoint(workDir, graph, graphPath);
  } catch {
    return; // checkpoint 不存在，忽略
  }

  const config = {
    ...DEFAULT_CONFIG,
    workDir,
    projectId,
    sessionId,
    outputDir: getSessionOutputDir(workDir, projectId, sessionId),
  };

  setActiveRunContext({ projectId, sessionId }, null);
  sseManager.reset();

  isRunning = true;
  updateSession(workDir, projectId, sessionId, { status: "running" });
  const startTime = Date.now();
  const prevNodeStatus = new Map<string, string>();

  try {
    const finalGraph = await run(graph.originalSpec, config, graph, (updatedGraph) => {
      for (const node of updatedGraph.nodes.values()) {
        const prev = prevNodeStatus.get(node.id);
        const statusChanged = prev !== node.status;
        const hasLiveToolCalls = node.status === "running" && (node.evidence?.toolCalls.length ?? 0) > 0;
        if (statusChanged || hasLiveToolCalls) {
          if (statusChanged) prevNodeStatus.set(node.id, node.status);
          sseManager.push({ type: "node_update", payload: toNodeStatus(node), projectId, sessionId });
        }
      }
    }, undefined, undefined, (checkpointNode, resume) => {
      if (autoApproveResumedCheckpoint) {
        autoApproveResumedCheckpoint = false;
        resume();
        return;
      }
      setPendingCheckpointResume(projectId, sessionId, checkpointNode.id, resume);
      updateSession(workDir, projectId, sessionId, { status: "paused" });
      isRunning = false;
      sseManager.push({
        type: "log",
        payload: `Paused at checkpoint ${checkpointNode.id}: ${checkpointNode.title}`,
        projectId,
        sessionId,
      });
    });

    const summary: GraphSummary = {
      id: finalGraph.id,
      title: finalGraph.title,
      status: finalGraph.status === "done" ? "done" : "failed",
      stats: {
        total: finalGraph.stats.total,
        done: finalGraph.stats.byStatus.done,
        failed: finalGraph.stats.byStatus.failed,
        filesGenerated: finalGraph.stats.filesGenerated,
        verificationsPassed: finalGraph.stats.verificationsPassed,
        verificationsRun: finalGraph.stats.verificationsRun,
      },
      durationMs: Date.now() - startTime,
    };

    sseManager.push({
      type: finalGraph.status === "done" ? "graph_done" : "graph_failed",
      payload: summary,
      projectId,
      sessionId,
    });
  } catch (e) {
    clearPendingCheckpointResume(projectId, sessionId);
    updateSession(workDir, projectId, sessionId, { status: "failed" });
    sseManager.push({ type: "log", payload: `Fatal error: ${(e as Error).message}`, projectId, sessionId });
  } finally {
    if (!getPendingCheckpointResume(projectId, sessionId)) {
      isRunning = false;
    }
  }
}
