/**
 * routes/node.ts — POST /node/:id/retry
 *
 * 手动重试某个失败的节点。
 * MVP 阶段：重置节点状态为 ready，等待调度器重新拾取。
 */

import { Router, Request, Response } from "express";
import { loadGraphCheckpoint, saveGraphCheckpoint } from "../../src/checkpoint";
import { transitionNode } from "../../src/graph";
import { RetryResponse } from "../types";

export const nodeRouter = Router();

nodeRouter.post("/node/:id/retry", (req: Request, res: Response) => {
  const id = req.params["id"] as string;

  try {
    const graph = loadGraphCheckpoint(process.cwd());
    const node = graph.nodes.get(id);

    if (!node) {
      res.status(404).json({ ok: false, error: `Node not found: ${String(id)}` } satisfies RetryResponse);
      return;
    }

    if (node.status !== "failed") {
      res.status(400).json({
        ok: false,
        error: `Node ${String(id)} is not in failed state (current: ${node.status})`,
      } satisfies RetryResponse);
      return;
    }

    const updated = transitionNode(graph, id, "ready");
    saveGraphCheckpoint(process.cwd(), updated);

    res.json({ ok: true } satisfies RetryResponse);
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message } satisfies RetryResponse);
  }
});
