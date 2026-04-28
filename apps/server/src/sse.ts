/**
 * sse.ts — SSE 推送管理器
 *
 * 职责：管理所有活跃的 SSE 连接，向所有客户端广播事件。
 * 规则：只做推送，不持有业务状态。
 */

import { Response } from "express";
import { SSEEvent, NodeStatus } from "./types";

class SSEManager {
  private clients = new Set<Response>();
  // 缓存最新节点状态，新客户端连接时回放
  private nodeCache = new Map<string, NodeStatus>();
  private lastSummary: SSEEvent | null = null;

  /** 注册新的 SSE 客户端连接，并回放当前状态 */
  addClient(res: Response): void {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    // 回放已有节点状态
    for (const node of this.nodeCache.values()) {
      res.write(`data: ${JSON.stringify({ type: "node_update", payload: node })}\n\n`);
    }
    // 回放最终摘要（如果任务已完成）
    if (this.lastSummary) {
      res.write(`data: ${JSON.stringify(this.lastSummary)}\n\n`);
    }

    this.clients.add(res);
    res.on("close", () => {
      this.clients.delete(res);
    });
  }

  /** 向所有客户端广播事件，并更新缓存 */
  push(event: SSEEvent): void {
    if (event.type === "node_update") {
      const node = event.payload as NodeStatus;
      this.nodeCache.set(node.id, node);
    } else if (event.type === "graph_done" || event.type === "graph_failed") {
      this.lastSummary = event;
    }

    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of this.clients) {
      client.write(data);
    }
  }

  /** 新任务开始时清空缓存 */
  reset(): void {
    this.nodeCache.clear();
    this.lastSummary = null;
  }

  get clientCount(): number {
    return this.clients.size;
  }
}

// 单例，整个 server 进程共享
export const sseManager = new SSEManager();
