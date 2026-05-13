import type { StatusResponse, ProjectsResponse, FileEntry, PreviewStatusResponse, ClarifyQuestion } from "../../types";
import type { SessionKey, SessionRef } from "../../features/session/types";
import type { ChatMessage } from "../execution/types";

export type WorkspaceSurface = "new-task" | "canvas" | "file" | "preview" | "settings";
export type CreationFlowStage = "idle" | "drafting" | "clarifying" | "reviewing_plan" | "starting_run";

export interface SelectedFileIdentity {
  projectId: string;
  sessionId: string;
  path: string;
}

export interface PendingClarification {
  baseSpec: string;
  questions: ClarifyQuestion[];
}

export interface CreationPendingPlan {
  originalSpec: string;
  repoPath?: string;
}

export interface CreationFlowState {
  stage: CreationFlowStage;
  input: string;
  messages: ChatMessage[];
  pendingClarification: PendingClarification | null;
  pendingPlan: CreationPendingPlan | null;
}

export interface WorkspaceState {
  activeSession: SessionRef | null;
  surface: WorkspaceSurface;
  creationFlow: CreationFlowState;
  selectedFile: SelectedFileIdentity | null;
  resumeInfo: StatusResponse | null;
  projects: ProjectsResponse["projects"];
  expandedProjectId: string | null;
  sessionFiles: FileEntry[];
  previewInfo: PreviewStatusResponse | null;
  // session管理选择态
  selectionMode: boolean;
  selectedSessions: Set<SessionKey>;
}
