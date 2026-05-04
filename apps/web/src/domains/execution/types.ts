import type { ClarifyQuestion, GraphSummary, NodeStatus } from "../../types";

export type GraphRunStatus = "idle" | "running" | "done" | "failed";
export type ExecutionSource = "snapshot" | "realtime" | "events" | "snapshot_fallback";
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
  source?: "snapshot" | "events" | "snapshot_fallback";
  revision?: number;
  parity?: {
    nodeCount: { snapshot: number; replay: number; match: boolean };
    statusDistribution: { snapshot: Record<string, number>; replay: Record<string, number>; match: boolean };
    terminalStatus: { snapshot: string | undefined; replay: string | undefined; match: boolean };
    mismatchedNodeStatuses: string[];
  } | null;
}

// ---- Chat message types ----

export type TextMessage = { role: "user" | "ai" | "system"; text: string };
export type ClarificationMessage = {
  role: "clarification";
  questions: ClarifyQuestion[];
  answered: boolean;
  answers?: Record<string, string>;
};
export type ChatMessage = TextMessage | ClarificationMessage;

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
  revision: number;
  parity: SessionGraphSnapshot["parity"];
  // chat history persisted per session
  chatMessages: ChatMessage[];
}
