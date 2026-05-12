import type { ChatMessage, SessionExecutionState } from "../../domains/execution/types";
import type { ActiveSession, SessionRef } from "../session/types";

export type ChatTab = "chat" | "log";
export type Message = ChatMessage;

export interface ChatProps {
  sessionRef?: SessionRef;
  onRunStarted?: (session: ActiveSession) => Promise<void> | void;
  onResumeRequested?: () => Promise<void> | void;
}

export const EMPTY_NODES: SessionExecutionState["nodes"] = {};
export const EMPTY_LOGS: string[] = [];
