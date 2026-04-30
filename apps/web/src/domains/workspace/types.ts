import type { StatusResponse, ProjectsResponse, FileEntry, PreviewStatusResponse } from "../../types";
import type { ActiveSession } from "../../features/session/types";

export interface SelectedFileIdentity {
  projectId: string;
  sessionId: string;
  path: string;
}

export interface WorkspaceState {
  activeSession: ActiveSession | null;
  selectedFile: SelectedFileIdentity | null;
  resumeInfo: StatusResponse | null;
  projects: ProjectsResponse["projects"];
  expandedProjectId: string | null;
  sessionFiles: FileEntry[];
  previewInfo: PreviewStatusResponse | null;
  // session管理选择态
  selectionMode: boolean;
  selectedSessions: Set<string>; // sessionId set
}
