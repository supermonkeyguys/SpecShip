import type { SessionRef } from "../../features/session/types";
import { toSessionKey } from "../../features/session/types";
import type { ExecutionStoreState } from "./store";
import type { ChatMessage, GraphRunStatus, SessionExecutionState } from "./types";

export function selectExecutionByKey(
  state: ExecutionStoreState,
  key: import("../../features/session/types").SessionKey | null | undefined
): SessionExecutionState | null {
  if (!key) return null;
  return state.sessions[key] ?? null;
}

export function selectExecutionByRef(
  state: ExecutionStoreState,
  session: SessionRef | null | undefined
): SessionExecutionState | null {
  if (!session) return null;
  return state.sessions[toSessionKey(session)] ?? null;
}

export function selectLiveExecution(state: ExecutionStoreState): SessionExecutionState | null {
  if (!state.liveSessionKey) return null;
  return state.sessions[state.liveSessionKey] ?? null;
}

export function selectRunStatusByRef(
  state: ExecutionStoreState,
  session: SessionRef | null | undefined
): GraphRunStatus {
  return selectExecutionByRef(state, session)?.runStatus ?? "idle";
}

export function selectChatMessagesByRef(
  state: ExecutionStoreState,
  session: SessionRef | null | undefined
): ChatMessage[] | null {
  return selectExecutionByRef(state, session)?.chatMessages ?? null;
}

export function selectHeaderRunStatus(
  state: ExecutionStoreState,
  activeSession: SessionRef | null | undefined
): GraphRunStatus {
  if (state.liveSessionKey) {
    return state.sessions[state.liveSessionKey]?.runStatus ?? "running";
  }
  return selectRunStatusByRef(state, activeSession);
}
