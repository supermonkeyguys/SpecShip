import { toSessionKey } from "../../features/session/types";
import type { WorkspaceState } from "./types";

export function selectActiveSession(state: WorkspaceState) {
  return state.activeSession;
}

export function selectActiveSessionKey(state: WorkspaceState) {
  return state.activeSession ? toSessionKey(state.activeSession) : null;
}

export function selectSurface(state: WorkspaceState) {
  return state.surface;
}

export function selectIsNewTaskSurface(state: WorkspaceState) {
  return state.surface === "new-task";
}

export function selectShouldShowExecutionRail(state: WorkspaceState) {
  return Boolean(state.activeSession);
}

export function selectCreationFlow(state: WorkspaceState) {
  return state.creationFlow;
}

export function selectCreationStage(state: WorkspaceState) {
  return state.creationFlow.stage;
}

export function selectSelectedFile(state: WorkspaceState) {
  return state.selectedFile;
}

export function selectResumeInfo(state: WorkspaceState) {
  return state.resumeInfo;
}

export function selectProjects(state: WorkspaceState) {
  return state.projects;
}

export function selectExpandedProjectId(state: WorkspaceState) {
  return state.expandedProjectId;
}

export function selectSessionFiles(state: WorkspaceState) {
  return state.sessionFiles;
}

export function selectPreviewInfo(state: WorkspaceState) {
  return state.previewInfo;
}

export function selectSelectionMode(state: WorkspaceState) {
  return state.selectionMode;
}

export function selectSelectedSessions(state: WorkspaceState) {
  return state.selectedSessions;
}

export function selectSelectedSessionCount(state: WorkspaceState) {
  return state.selectedSessions.size;
}

// 模块级缓存：输入 projects 引用不变则返回上一次结果，避免每次 render 产生新数组引用
let _flatSessionsCache: ReturnType<typeof _computeFlatSessions> = [];
let _flatSessionsProjects: WorkspaceState["projects"] | null = null;

function _computeFlatSessions(projects: WorkspaceState["projects"]) {
  return projects
    .flatMap((project) =>
      project.sessions.map((session) => ({
        key: toSessionKey(project.id, session.id),
        projectId: project.id,
        sessionId: session.id,
        spec: session.spec,
        status: session.status,
        starred: session.starred ?? false,
        createdAt: session.createdAt,
      }))
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function selectFlatSessions(state: WorkspaceState) {
  if (state.projects !== _flatSessionsProjects) {
    _flatSessionsProjects = state.projects;
    _flatSessionsCache = _computeFlatSessions(state.projects);
  }
  return _flatSessionsCache;
}
