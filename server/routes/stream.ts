/**
 * routes/stream.ts — GET /stream
 *
 * SSE 端点，客户端连接后持续接收节点状态更新。
 */

import { Router, Request, Response } from "express";
import { sseManager } from "../sse";

export const streamRouter = Router();

streamRouter.get("/stream", (req: Request, res: Response) => {
  sseManager.addClient(res);
  // 连接建立后发送一个心跳，确认连接正常
  res.write(`data: ${JSON.stringify({ type: "log", payload: "connected" })}\n\n`);
});
