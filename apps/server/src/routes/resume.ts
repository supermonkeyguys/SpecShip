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
import {
  getSessionGraphPath,
  listProjects,
  listSessions,
  getSessionOutputDir,
  updateSession,
} from "../project";
import {
  appendSessionOperation,
  getSessionRevision,
} from "../op-log";

const ORCHESTRATOR_MODE = process.env.ORCHESTRATOR_MODE ?? "legacy";

export const resumeRouter = Router();

const runningSessions = new Set<string>();

function sessionKey(projectId: string, sessionId: string): string {
  return `${projectId}:${sessionId}`;
}

const DEBUG_PREFIX = "[shipyard:server:resume]";

export function setSessionRunning(projectId: string, sessionId: string, running: boolean): void {
  const key = sessionKey(projectId, sessionId);
  if (running) runningSessions.add(key);
  else runningSessions.delete(key);
}

export function isSessionRunning(projectId: string, sessionId: string): boolean {
  return runningSessions.has(sessionKey(projectId, sessionId));
}

/** 是否有任何 session 正在运行 — 用于全局互斥 guard */
export function getIsRunning(): boolean {
  return runningSessions.size > 0;
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
        isRunning: getIsRunning() || hasUnfinished,
        canResume: hasUnfinished && !getIsRunning(),
        nodeCount: statuses.length,
        doneCount,
        projectId: activeSession.projectId,
        sessionId: activeSession.sessionId,
      } satisfies StatusResponse);
      return;
    } catch {
      res.json({
        isRunning: getIsRunning(),
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
        isRunning: getIsRunning(),
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
      isRunning: getIsRunning(),
      canResume: hasUnfinished && !getIsRunning(),
      spec: graph.originalSpec,
      nodeCount: total,
      doneCount,
      projectId: target.projectId,
      sessionId: target.sessionId,
    } satisfies StatusResponse);
  } catch {
    res.json({
      isRunning: getIsRunning(),
      canResume: false,
      projectId: activeSession?.projectId,
      sessionId: activeSession?.sessionId,
    } satisfies StatusResponse);
  }
});

resumeRouter.post("/resume", async (req: Request, res: Response) => {
  if (getIsRunning()) {
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

      appendShadowOperation(workDir, projectId, sessionId, "resume", "checkpoint.resumed", {
        workflowId: resolvedWorkflowId,
      }, "server");
      appendShadowOperation(workDir, projectId, sessionId, "resume", "session.status_set", {
        status: "running",
      }, "server");

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
    appendShadowOperation(workDir, target.projectId, target.sessionId, "resume", "checkpoint.resumed", {
      nodeId: pendingCheckpoint.nodeId,
    }, "server");
    appendShadowOperation(workDir, target.projectId, target.sessionId, "resume", "session.status_set", {
      status: "running",
    }, "server");
    setSessionRunning(target.projectId, target.sessionId, true);
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

  appendShadowOperation(workDir, target.projectId, target.sessionId, "resume", "checkpoint.resumed", {
    graphId: graph.id,
  }, "server");

  sseManager.reset();
  res.json({
    ok: true,
    graphId: graph.id,
    projectId: target.projectId,
    sessionId: target.sessionId,
  } satisfies ResumeResponse);

  setSessionRunning(target.projectId, target.sessionId, true);
  updateSession(workDir, target.projectId, target.sessionId, { status: "running" });
  appendShadowOperation(workDir, target.projectId, target.sessionId, "resume", "session.status_set", {
    status: "running",
  }, "server");
  const startTime = Date.now();
  const prevNodeStatus = new Map<string, string>();
  let graphInitialized = false;

  try {
    const finalGraph = await run(graph.originalSpec, config, graph, (updatedGraph) => {
      if (!graphInitialized) {
        appendShadowOperation(workDir, target.projectId, target.sessionId, "scheduler", "graph.initialized", {
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
            appendNodeOpsFromStatus(workDir, target.projectId, target.sessionId, node, "scheduler");
          } else if (hasLiveToolCalls) {
            appendShadowOperation(workDir, target.projectId, target.sessionId, "scheduler", "node.evidence_appended", {
              nodeId: node.id,
              filesWritten: node.evidence?.filesWritten.map((f) => f.path) ?? [],
              toolCalls: node.evidence?.toolCalls ?? [],
              verifications: node.evidence?.verifications ?? [],
            });
          }

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
      appendShadowOperation(workDir, target.projectId, target.sessionId, "checkpoint", "checkpoint.paused", {
        nodeId: checkpointNode.id,
        title: checkpointNode.title,
      });
      appendShadowOperation(workDir, target.projectId, target.sessionId, "checkpoint", "session.status_set", {
        status: "paused",
      });
      setSessionRunning(target.projectId, target.sessionId, false);
      sseManager.push({
        type: "log",
        payload: `Paused at checkpoint ${checkpointNode.id}: ${checkpointNode.title}`,
        projectId: target.projectId,
        sessionId: target.sessionId,
      });
    });

    clearPendingCheckpointResume(target.projectId, target.sessionId);
    const finalSessionStatus = mapGraphStatusToSessionStatus(finalGraph.status);
    updateSession(workDir, target.projectId, target.sessionId, {
      status: finalSessionStatus,
    });
    appendShadowOperation(workDir, target.projectId, target.sessionId, "scheduler", "session.status_set", {
      status: finalSessionStatus,
    });
    appendShadowOperation(workDir, target.projectId, target.sessionId, "scheduler", finalGraph.status === "done" ? "graph.completed" : "graph.failed", {
      graphId: finalGraph.id,
      title: finalGraph.title,
      status: finalGraph.status,
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
    appendShadowOperation(workDir, target.projectId, target.sessionId, "scheduler", "session.status_set", {
      status: "failed",
    });
    appendShadowOperation(workDir, target.projectId, target.sessionId, "scheduler", "graph.failed", {
      error: (e as Error).message,
    });
    sseManager.push({
      type: "log",
      payload: `Fatal error: ${(e as Error).message}`,
      projectId: target.projectId,
      sessionId: target.sessionId,
    });
  } finally {
    if (!getPendingCheckpointResume(target.projectId, target.sessionId)) {
      setSessionRunning(target.projectId, target.sessionId, false);
    }
  }
});

function toNodeStatus(node: GraphNode): NodeStatus {
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
    error: node.error?.message,
    errorCategory: node.error?.category,
    errorRecoverable: node.error?.recoverable,
    durationMs: node.evidence?.durationMs,
  };
}

export async function runResumeSession(
  projectId: string,
  sessionId: string,
): Promise<void> {
  if (isSessionRunning(projectId, sessionId)) return;

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
    return;
  }

  appendShadowOperation(workDir, projectId, sessionId, "resume", "checkpoint.resumed", {
    graphId: graph.id,
  }, "server");

  const config = {
    ...DEFAULT_CONFIG,
    workDir,
    projectId,
    sessionId,
    outputDir: getSessionOutputDir(workDir, projectId, sessionId),
  };

  setActiveRunContext({ projectId, sessionId }, null);
  sseManager.reset();

  setSessionRunning(projectId, sessionId, true);
  updateSession(workDir, projectId, sessionId, { status: "running" });
  appendShadowOperation(workDir, projectId, sessionId, "resume", "session.status_set", {
    status: "running",
  }, "server");
  const startTime = Date.now();
  const prevNodeStatus = new Map<string, string>();
  let graphInitialized = false;

  try {
    const finalGraph = await run(graph.originalSpec, config, graph, (updatedGraph) => {
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
      if (autoApproveResumedCheckpoint) {
        autoApproveResumedCheckpoint = false;
        resume();
        return;
      }
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
    });

    const finalSessionStatus = mapGraphStatusToSessionStatus(finalGraph.status);
    updateSession(workDir, projectId, sessionId, { status: finalSessionStatus });
    appendShadowOperation(workDir, projectId, sessionId, "scheduler", "session.status_set", {
      status: finalSessionStatus,
    });
    appendShadowOperation(workDir, projectId, sessionId, "scheduler", finalGraph.status === "done" ? "graph.completed" : "graph.failed", {
      graphId: finalGraph.id,
      title: finalGraph.title,
      status: finalGraph.status,
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
    appendShadowOperation(workDir, projectId, sessionId, "scheduler", "session.status_set", {
      status: "failed",
    });
    appendShadowOperation(workDir, projectId, sessionId, "scheduler", "graph.failed", {
      error: (e as Error).message,
    });
    sseManager.push({ type: "log", payload: `Fatal error: ${(e as Error).message}`, projectId, sessionId });
  } finally {
    if (!getPendingCheckpointResume(projectId, sessionId)) {
      setSessionRunning(projectId, sessionId, false);
    }
  }
}
