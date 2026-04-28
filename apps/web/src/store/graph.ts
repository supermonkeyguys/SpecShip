/**
 * store/graph.ts — legacy compatibility facade
 *
 * 过渡期兼容层：把旧的单 session graph 读取桥接到新的 session-aware execution store。
 * 新代码应优先直接使用 domains/execution。
 */

import { useMemo } from "react";
import type { NodeStatus, GraphSummary, SSEEvent } from "../types";
import { useExecutionStore } from "../domains/execution/store";
import type { GraphRunStatus } from "../domains/execution/types";

interface GraphStore {
  nodes: Record<string, NodeStatus>;
  logs: string[];
  runStatus: GraphRunStatus;
  summary: GraphSummary | null;
  updateNode: (node: NodeStatus) => void;
  appendLog: (msg: string) => void;
  setRunStatus: (status: GraphRunStatus) => void;
  setSummary: (summary: GraphSummary) => void;
  reset: () => void;
}

const EMPTY_NODES: Record<string, NodeStatus> = {};
const EMPTY_LOGS: string[] = [];

function getTargetSessionId(): string | null {
  const state = useExecutionStore.getState();
  return state.activeSessionId ?? state.liveSessionId ?? null;
}

const updateNode = (node: NodeStatus) => {
  useExecutionStore.getState().applyRealtimeEvent(
    { type: "node_update", payload: node },
    getTargetSessionId() ?? undefined
  );
};

const appendLog = (msg: string) => {
  const targetSessionId = getTargetSessionId();
  if (!targetSessionId) return;
  useExecutionStore.getState().appendSessionLog(targetSessionId, msg);
};

const setRunStatus = (status: GraphRunStatus) => {
  const targetSessionId = getTargetSessionId();
  if (!targetSessionId) return;
  useExecutionStore.getState().setSessionRunStatus(targetSessionId, status);
};

const setSummary = (summary: GraphSummary) => {
  useExecutionStore.getState().applyRealtimeEvent(
    {
      type: summary.status === "done" ? "graph_done" : "graph_failed",
      payload: summary,
    },
    getTargetSessionId() ?? undefined
  );
};

const reset = () => {
  const targetSessionId = getTargetSessionId();
  if (!targetSessionId) return;
  const latestState = useExecutionStore.getState();
  useExecutionStore.getState().replaceSessionSnapshot(
    {
      projectId: latestState.sessions[targetSessionId]?.projectId ?? "",
      sessionId: targetSessionId,
    },
    { ok: true, nodes: [], title: "", status: "unknown" },
    { optimisticRunStatus: "idle" }
  );
};

type Selector<T> = (state: GraphStore) => T;

export function useGraphStore(): GraphStore;
export function useGraphStore<T>(selector: Selector<T>): T;
export function useGraphStore<T>(selector?: Selector<T>): GraphStore | T {
  const nodes = useExecutionStore((state) => {
    const sessionId = state.activeSessionId ?? state.liveSessionId;
    return sessionId ? state.sessions[sessionId]?.nodes ?? EMPTY_NODES : EMPTY_NODES;
  });

  const logs = useExecutionStore((state) => {
    const sessionId = state.activeSessionId ?? state.liveSessionId;
    return sessionId ? state.sessions[sessionId]?.logs ?? EMPTY_LOGS : EMPTY_LOGS;
  });

  const runStatus = useExecutionStore((state) => {
    const sessionId = state.activeSessionId ?? state.liveSessionId;
    return sessionId ? state.sessions[sessionId]?.runStatus ?? "idle" : "idle";
  });

  const summary = useExecutionStore((state) => {
    const sessionId = state.activeSessionId ?? state.liveSessionId;
    return sessionId ? state.sessions[sessionId]?.summary ?? null : null;
  });

  const graphStore = useMemo<GraphStore>(
    () => ({
      nodes,
      logs,
      runStatus,
      summary,
      updateNode,
      appendLog,
      setRunStatus,
      setSummary,
      reset,
    }),
    [nodes, logs, runStatus, summary]
  );

  return selector ? selector(graphStore) : graphStore;
}

export type { GraphRunStatus } from "../domains/execution/types";

/** 从 SSE 事件更新 store（兼容旧调用方） */
export function applySSEEvent(event: SSEEvent, store?: GraphStore): void {
  if (store) {
    switch (event.type) {
      case "node_update":
        store.updateNode(event.payload as NodeStatus);
        break;
      case "graph_done":
      case "graph_failed":
        store.setSummary(event.payload as GraphSummary);
        break;
      case "log":
        store.appendLog(event.payload as string);
        break;
    }
    return;
  }

  useExecutionStore.getState().applyRealtimeEvent(event, getTargetSessionId() ?? undefined);
}
