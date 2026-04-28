/**
 * sse-projection.ts — Temporal 路径的 SSE 推送适配器
 *
 * Temporal Worker 执行 notifyNodeUpdate Activity 时，将节点状态写入：
 *   .shipyard/sse-projection/<sessionId>/<nodeId>.json
 *
 * 本模块用 fs.watch 监听该目录，检测到写入后读取文件内容，
 * 推 SSE node_update 事件给前端，保持和 legacy 路径相同的 SSE 协议。
 *
 * 每次新 session 开始时调用 watchSession()，session 结束或切换时调用 stopWatch()。
 */

import * as fs from "fs";
import * as path from "path";
import { sseManager } from "./sse";
import type { NodeStatus } from "./types";

interface ProjectionPayload {
  nodeId: string;
  status: NodeStatus["status"];
  filesWritten: string[];
  error?: string;
  updatedAt: string;
}

let activeWatcher: fs.FSWatcher | null = null;

/** 开始监听 session 的 projection 目录 */
export function watchSession(workDir: string, projectId: string, sessionId: string): void {
  stopWatch();

  const projDir = path.join(workDir, ".shipyard", "sse-projection", sessionId);
  fs.mkdirSync(projDir, { recursive: true });

  activeWatcher = fs.watch(projDir, { persistent: false }, (_event, filename) => {
    if (!filename?.endsWith(".json")) return;

    const filePath = path.join(projDir, filename);
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const payload = JSON.parse(raw) as ProjectionPayload;

      const nodeStatus: NodeStatus = {
        id: payload.nodeId,
        title: payload.nodeId,
        status: payload.status,
        specFragment: "",
        dependsOn: [],
        filesWritten: payload.filesWritten,
        verifications: [],
        retryCount: 0,
        error: payload.error,
      };

      sseManager.push({ type: "node_update", payload: nodeStatus, projectId, sessionId });
    } catch {
      // 文件写入中途读到不完整 JSON，忽略，等下次写入
    }
  });
}

/** 停止监听（session 结束或切换时调用）*/
export function stopWatch(): void {
  if (activeWatcher) {
    activeWatcher.close();
    activeWatcher = null;
  }
}
