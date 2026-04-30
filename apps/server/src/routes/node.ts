/**
 * routes/node.ts — POST /node/:id/retry
 *
 * legacy：重置 session graph 的 failed 节点为 ready。
 * temporal：发送 retryNode signal 给当前 workflow。
 */

import { Router, Request, Response } from "express";
import { loadGraphCheckpoint, saveGraphCheckpoint } from "../checkpoint";
import { transitionNode } from "../graph";
import { RetryResponse } from "../types";
import { getSessionGraphPath } from "../project";
import { activeSession, activeWorkflowId } from "./run";
import { runResumeSession } from "./resume";

export const nodeRouter = Router();

const ORCHESTRATOR_MODE = process.env.ORCHESTRATOR_MODE ?? "legacy";

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

  const graphPath = getSessionGraphPath(process.env.WORK_DIR ?? process.cwd(), projectId, sessionId);

  try {
    const graph = loadGraphCheckpoint(process.env.WORK_DIR ?? process.cwd(), graphPath);
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

    // ready 状态说明已经在队列中，不需要再改状态
    if (node.status === "ready") {
      res.json({ ok: true } satisfies RetryResponse);
      return;
    }

    const updated = transitionNode(graph, id, "ready");
    saveGraphCheckpoint(process.env.WORK_DIR ?? process.cwd(), updated, graphPath);

    res.json({ ok: true } satisfies RetryResponse);

    // 异步触发调度循环恢复执行，不阻塞响应
    runResumeSession(projectId, sessionId).catch(() => {});
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message } satisfies RetryResponse);
  }
});
