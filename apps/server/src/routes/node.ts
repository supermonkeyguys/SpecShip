/**
 * routes/node.ts — POST /node/:id/retry, POST /node/:id/edit
 *
 * legacy：重置 session graph 的 failed 节点为 ready。
 * temporal：发送 retryNode signal 给当前 workflow。
 */

import { Router, Request, Response } from "express";
import { loadGraphCheckpoint, saveGraphCheckpoint } from "../checkpoint";
import { transitionNode } from "../graph";
import { RetryResponse, NodeEditRequest, NodeEditResponse } from "../types";
import { getSessionGraphPath } from "../project";
import { appendSessionOperation, getSessionRevision } from "../op-log";
import { activeSession, activeWorkflowId } from "./run";
import { runResumeSession } from "./resume";

export const nodeRouter = Router();

const ORCHESTRATOR_MODE = process.env.ORCHESTRATOR_MODE ?? "legacy";
const DEBUG_PREFIX = "[shipyard:server:node]";

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

nodeRouter.post("/node/:id/retry", async (req: Request, res: Response) => {
  const id = req.params["id"] as string;

  if (ORCHESTRATOR_MODE === "temporal") {
    if (!activeSession) {
      res.status(400).json({ ok: false, error: "No active session" } satisfies RetryResponse);
      return;
    }

    try {
      const { querySpecRunSummary, signalRetryNode, buildWorkflowId } = await import("@shipyard/orchestrator-temporal") as typeof import("@shipyard/orchestrator-temporal");
      const workflowId = activeWorkflowId ?? buildWorkflowId(activeSession.projectId, activeSession.sessionId);

      const summary = await querySpecRunSummary({ workflowId });
      const status = summary.nodeStatuses[id];

      if (!status) {
        res.status(404).json({ ok: false, error: `Node not found: ${String(id)}` } satisfies RetryResponse);
        return;
      }

      if (status !== "failed") {
        res.status(400).json({
          ok: false,
          error: `Node ${String(id)} is not in failed state (current: ${status})`,
        } satisfies RetryResponse);
        return;
      }

      await signalRetryNode({ workflowId, nodeId: id });
      const workDir = process.env.WORK_DIR ?? process.cwd();
      appendShadowOperation(workDir, activeSession.projectId, activeSession.sessionId, "retry", "node.retry_scheduled", {
        nodeId: id,
      }, "user");
      res.json({ ok: true } satisfies RetryResponse);
      return;
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message } satisfies RetryResponse);
      return;
    }
  }

  const { projectId, sessionId } = req.body as { projectId?: string; sessionId?: string };

  if (!projectId || !sessionId) {
    res.status(400).json({ ok: false, error: "projectId and sessionId are required" } satisfies RetryResponse);
    return;
  }

  const workDir = process.env.WORK_DIR ?? process.cwd();
  const graphPath = getSessionGraphPath(workDir, projectId, sessionId);

  try {
    const graph = loadGraphCheckpoint(workDir, graphPath);
    const node = graph.nodes.get(id);

    if (!node) {
      res.status(404).json({ ok: false, error: `Node not found: ${String(id)}` } satisfies RetryResponse);
      return;
    }

    const retryableStatuses = ["failed", "running", "verifying", "ready"];
    if (!retryableStatuses.includes(node.status)) {
      res.status(400).json({
        ok: false,
        error: `Node ${String(id)} cannot be retried (current: ${node.status})`,
      } satisfies RetryResponse);
      return;
    }

    if (node.status === "ready") {
      res.json({ ok: true } satisfies RetryResponse);
      return;
    }

    const updated = transitionNode(graph, id, "ready");
    saveGraphCheckpoint(workDir, updated, graphPath);

    const updatedNode = updated.nodes.get(id)!;
    appendShadowOperation(workDir, projectId, sessionId, "retry", "node.retry_scheduled", {
      nodeId: id,
      retryCount: updatedNode.retryCount,
      maxRetries: updatedNode.maxRetries,
    }, "user");
    appendShadowOperation(workDir, projectId, sessionId, "retry", "node.status_set", {
      nodeId: id,
      title: updatedNode.title,
      nodeType: updatedNode.type,
      specFragment: updatedNode.specFragment,
      dependsOn: updatedNode.dependsOn,
      status: updatedNode.status,
      retryCount: updatedNode.retryCount,
      maxRetries: updatedNode.maxRetries,
      error: updatedNode.error?.message,
      errorCategory: updatedNode.error?.category,
      errorRecoverable: updatedNode.error?.recoverable,
      durationMs: updatedNode.evidence?.durationMs,
    }, "user");

    res.json({ ok: true } satisfies RetryResponse);

    runResumeSession(projectId, sessionId).catch(() => {});
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message } satisfies RetryResponse);
  }
});

nodeRouter.post("/node/:id/edit", async (req: Request, res: Response) => {
  const nodeId = req.params["id"] as string;
  const { projectId, sessionId, updates } = req.body as NodeEditRequest;

  if (!projectId || !sessionId) {
    res.status(400).json({ ok: false, error: "projectId and sessionId are required" } satisfies NodeEditResponse);
    return;
  }

  if (!updates || Object.keys(updates).length === 0) {
    res.status(400).json({ ok: false, error: "updates object is required" } satisfies NodeEditResponse);
    return;
  }

  const workDir = process.env.WORK_DIR ?? process.cwd();
  const graphPath = getSessionGraphPath(workDir, projectId, sessionId);

  try {
    const { editNodeAndRecalculate } = await import("../graph");
    const graph = loadGraphCheckpoint(workDir, graphPath);

    if (!graph.nodes.has(nodeId)) {
      res.status(404).json({ ok: false, error: `Node not found: ${nodeId}` });
      return;
    }

    const { graph: updatedGraph, impact } = editNodeAndRecalculate(graph, nodeId, updates);
    saveGraphCheckpoint(workDir, updatedGraph, graphPath);

    // Log the operation for event sourcing
    appendShadowOperation(workDir, projectId, sessionId, "retry", "node.status_set", {
      nodeId,
      title: updates.title,
      specFragment: updates.specFragment,
      dependsOn: updates.dependsOn,
      status: "ready",
      retryCount: 0,
      maxRetries: undefined,
    }, "user");

    res.json({
      ok: true,
      impact: {
        changedNodeId: impact.changedNodeId,
        changeKind: impact.changeKind,
        description: impact.description,
        nodesStillValid: impact.nodesStillValid,
        nodesNeedRerun: impact.nodesNeedRerun,
        totalAffected: impact.totalAffected,
        totalUnaffected: impact.totalUnaffected,
      },
    } satisfies NodeEditResponse);
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message } satisfies NodeEditResponse);
  }
});
