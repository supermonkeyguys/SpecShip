import type { SessionRef } from "../../features/session/types";
import { selectActiveSession, selectResumeInfo } from "../workspace/selectors";
import { selectExecutionByRef, selectLiveExecution } from "../execution/selectors";
import type { ExecutionStoreState } from "../execution/store";
import type { WorkspaceState } from "../workspace/types";
import type { GraphRunStatus, SessionExecutionState } from "../execution/types";

export function selectActiveExecution(
  workspace: WorkspaceState,
  execution: ExecutionStoreState
): SessionExecutionState | null {
  return selectExecutionByRef(execution, selectActiveSession(workspace));
}

export function selectActiveRunStatus(
  workspace: WorkspaceState,
  execution: ExecutionStoreState
): GraphRunStatus {
  return selectActiveExecution(workspace, execution)?.runStatus ?? "idle";
}

export function selectHeaderRunStatus(
  workspace: WorkspaceState,
  execution: ExecutionStoreState
): GraphRunStatus {
  return selectLiveExecution(execution)?.runStatus ?? selectActiveRunStatus(workspace, execution);
}

export function selectActiveSessionTitle(
  workspace: WorkspaceState,
  execution: ExecutionStoreState
): string {
  const activeRef = selectActiveSession(workspace);
  const activeExecution = selectActiveExecution(workspace, execution);
  if (activeExecution?.title) return activeExecution.title;
  if (!activeRef) return "";
  const project = workspace.projects.find((p) => p.id == activeRef.projectId);
  const session = project?.sessions.find((s) => s.id == activeRef.sessionId);
  return session?.spec ?? "";
}

export function selectResumeTargetRef(workspace: WorkspaceState): SessionRef | null {
  const info = selectResumeInfo(workspace);
  if (!info?.projectId || !info?.sessionId) return null;
  return { projectId: info.projectId, sessionId: info.sessionId };
}
