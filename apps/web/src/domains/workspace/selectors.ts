import type { WorkspaceState } from "./types";

export function selectActiveSession(state: WorkspaceState) {
  return state.activeSession;
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
