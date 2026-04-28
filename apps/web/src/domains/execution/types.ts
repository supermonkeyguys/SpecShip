import type { GraphSummary, NodeStatus } from "../../types";

export type GraphRunStatus = "idle" | "running" | "done" | "failed";
export type ExecutionSource = "snapshot" | "realtime";
export type StreamStatus = "disconnected" | "connecting" | "connected" | "error";

export interface SessionRef {
  projectId: string;
  sessionId: string;
  spec?: string;
}

export interface SessionGraphSnapshot {
  ok: boolean;
  nodes: NodeStatus[];
  title: string;
  status: string;
}

export interface SessionExecutionState {
  projectId: string;
  sessionId: string;
  title: string;
  nodes: Record<string, NodeStatus>;
  logs: string[];
  summary: GraphSummary | null;
  runStatus: GraphRunStatus;
  source: ExecutionSource;
  lastUpdatedAt: number | null;
}
