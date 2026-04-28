import type { StatusResponse, ProjectsResponse, FileEntry } from "../../types";
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
}
