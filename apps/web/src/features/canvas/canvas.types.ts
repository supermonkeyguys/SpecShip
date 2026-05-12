import type { ReactNode } from "react";
import type { SessionExecutionState } from "../../domains/execution/types";

export type CanvasNodes = SessionExecutionState["nodes"];

export interface CanvasSessionRef {
  projectId: string;
  sessionId: string;
}

export interface CanvasFlowNodeData {
  label: ReactNode;
}
