/**
 * store/graph.ts — Zustand 全局状态
 *
 * 规则：组件只从这里读状态，不自己持有节点数据。
 */

import { create } from "zustand";
import type { NodeStatus, GraphSummary, SSEEvent } from "../../../server/types";

interface GraphStore {
  // 节点状态（id → NodeStatus）
  nodes: Record<string, NodeStatus>;
  // 执行日志
  logs: string[];
  // 整体状态
  runStatus: "idle" | "running" | "done" | "failed";
  // 最终图摘要
  summary: GraphSummary | null;

  // actions
  updateNode: (node: NodeStatus) => void;
  appendLog: (msg: string) => void;
  setRunStatus: (status: GraphStore["runStatus"]) => void;
  setSummary: (summary: GraphSummary) => void;
  reset: () => void;
}

export const useGraphStore = create<GraphStore>((set) => ({
  nodes: {},
  logs: [],
  runStatus: "idle",
  summary: null,

  updateNode: (node) =>
    set((state) => ({ nodes: { ...state.nodes, [node.id]: node } })),

  appendLog: (msg) =>
    set((state) => ({ logs: [...state.logs, msg] })),

  setRunStatus: (runStatus) => set({ runStatus }),

  setSummary: (summary) => set({ summary }),

  reset: () => set({ nodes: {}, logs: [], runStatus: "idle", summary: null }),
}));

/** 从 SSE 事件更新 store（在 useSSE hook 里调用）*/
export function applySSEEvent(event: SSEEvent, store: GraphStore): void {
  switch (event.type) {
    case "node_update":
      store.updateNode(event.payload as NodeStatus);
      break;
    case "graph_done":
      store.setSummary(event.payload as GraphSummary);
      store.setRunStatus("done");
      break;
    case "graph_failed":
      store.setSummary(event.payload as GraphSummary);
      store.setRunStatus("failed");
      break;
    case "log":
      store.appendLog(event.payload as string);
      break;
  }
}
