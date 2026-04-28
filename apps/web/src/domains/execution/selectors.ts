import type { ExecutionStoreState } from "./store";
import type { SessionExecutionState, GraphRunStatus } from "./types";

export function selectActiveExecution(state: ExecutionStoreState): SessionExecutionState | null {
  if (!state.activeSessionId) return null;
  return state.sessions[state.activeSessionId] ?? null;
}

export function selectExecutionBySessionId(
  state: ExecutionStoreState,
  sessionId: string | null | undefined
): SessionExecutionState | null {
  if (!sessionId) return null;
  return state.sessions[sessionId] ?? null;
}

export function selectHeaderRunStatus(state: ExecutionStoreState): GraphRunStatus {
  if (state.liveSessionId) {
    return state.sessions[state.liveSessionId]?.runStatus ?? "running";
  }
  if (state.activeSessionId) {
    return state.sessions[state.activeSessionId]?.runStatus ?? "idle";
  }
  return "idle";
}
