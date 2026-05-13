import { create } from "zustand";
import type { ChatMessage } from "../execution/types";
import type { SessionKey, SessionRef } from "../../features/session/types";
import type { StatusResponse, ProjectsResponse, FileEntry, PreviewStatusResponse } from "../../types";
import type {
  CreationFlowState,
  CreationFlowStage,
  CreationPendingPlan,
  PendingClarification,
  SelectedFileIdentity,
  WorkspaceState,
  WorkspaceSurface,
} from "./types";

const INITIAL_CREATION_MESSAGES: ChatMessage[] = [
  { role: "system", text: "Hi! Tell me what to build. I will help refine it into an execution plan before starting." },
];

function createInitialCreationFlow(): CreationFlowState {
  return {
    stage: "idle",
    input: "",
    messages: [...INITIAL_CREATION_MESSAGES],
    pendingClarification: null,
    pendingPlan: null,
  };
}

interface WorkspaceStore extends WorkspaceState {
  setActiveSession: (session: SessionRef | null) => void;
  setSurface: (surface: WorkspaceSurface) => void;
  showPrimarySurface: () => void;
  setCreationInput: (input: string) => void;
  setCreationStage: (stage: CreationFlowStage) => void;
  setCreationPendingClarification: (pendingClarification: PendingClarification | null) => void;
  setCreationPendingPlan: (pendingPlan: CreationPendingPlan | null) => void;
  setCreationMessages: (messages: ChatMessage[]) => void;
  appendCreationMessage: (message: ChatMessage) => void;
  resetCreationFlow: () => void;
  setSelectedFile: (file: SelectedFileIdentity | null) => void;
  setResumeInfo: (resumeInfo: StatusResponse | null) => void;
  setProjects: (projects: ProjectsResponse["projects"]) => void;
  setExpandedProjectId: (projectId: string | null) => void;
  setSessionFiles: (files: FileEntry[]) => void;
  setPreviewInfo: (previewInfo: PreviewStatusResponse | null) => void;
  clearSelectedFileIfSessionMismatch: (session: SessionRef | null) => void;
  resetSessionScopedView: () => void;
  // selection
  setSelectionMode: (on: boolean) => void;
  toggleSessionSelected: (sessionKey: SessionKey) => void;
  clearSelection: () => void;
}

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  activeSession: null,
  surface: "new-task",
  creationFlow: createInitialCreationFlow(),
  selectedFile: null,
  resumeInfo: null,
  projects: [],
  expandedProjectId: null,
  sessionFiles: [],
  previewInfo: null,
  selectionMode: false,
  selectedSessions: new Set<SessionKey>(),

  setActiveSession: (session) =>
    set({
      activeSession: session,
      surface: session ? "canvas" : "new-task",
    }),

  setSurface: (surface) => set({ surface }),

  showPrimarySurface: () =>
    set((state) => ({
      surface: state.activeSession ? "canvas" : "new-task",
    })),

  setCreationInput: (input) =>
    set((state) => ({
      creationFlow: {
        ...state.creationFlow,
        input,
        stage: input.trim().length > 0 && state.creationFlow.stage === "idle" ? "drafting" : state.creationFlow.stage,
      },
    })),

  setCreationStage: (stage) =>
    set((state) => ({
      creationFlow: {
        ...state.creationFlow,
        stage,
      },
    })),

  setCreationPendingClarification: (pendingClarification) =>
    set((state) => ({
      creationFlow: {
        ...state.creationFlow,
        pendingClarification,
      },
    })),

  setCreationPendingPlan: (pendingPlan) =>
    set((state) => ({
      creationFlow: {
        ...state.creationFlow,
        pendingPlan,
      },
    })),

  setCreationMessages: (messages) =>
    set((state) => ({
      creationFlow: {
        ...state.creationFlow,
        messages,
      },
    })),

  appendCreationMessage: (message) =>
    set((state) => ({
      creationFlow: {
        ...state.creationFlow,
        messages: [...state.creationFlow.messages, message],
      },
    })),

  resetCreationFlow: () =>
    set({
      creationFlow: createInitialCreationFlow(),
    }),

  setSelectedFile: (file) =>
    set((state) => ({
      selectedFile: file,
      surface: file ? "file" : state.activeSession ? "canvas" : "new-task",
    })),

  setResumeInfo: (resumeInfo) => set({ resumeInfo }),
  setProjects: (projects) =>
    set((state) => {
      const fallbackExpanded = projects.length > 0 ? projects[0].id : null;
      if (state.expandedProjectId && projects.some((p) => p.id === state.expandedProjectId)) {
        return { projects };
      }
      return {
        projects,
        expandedProjectId: fallbackExpanded,
      };
    }),
  setExpandedProjectId: (projectId) => set({ expandedProjectId: projectId }),
  setSessionFiles: (sessionFiles) => set({ sessionFiles }),
  setPreviewInfo: (previewInfo) => set({ previewInfo }),

  clearSelectedFileIfSessionMismatch: (session) =>
    set((state) => {
      if (!state.selectedFile) return state;
      if (!session) {
        return { selectedFile: null, surface: "new-task" };
      }
      if (
        state.selectedFile.projectId !== session.projectId ||
        state.selectedFile.sessionId !== session.sessionId
      ) {
        return { selectedFile: null, surface: "canvas" };
      }
      return state;
    }),

  resetSessionScopedView: () =>
    set((state) => ({
      selectedFile: null,
      sessionFiles: [],
      previewInfo: null,
      surface: state.activeSession ? "canvas" : "new-task",
    })),

  setSelectionMode: (on) =>
    set({ selectionMode: on, selectedSessions: new Set<SessionKey>() }),

  toggleSessionSelected: (sessionKey) =>
    set((state) => {
      const next = new Set(state.selectedSessions);
      if (next.has(sessionKey)) next.delete(sessionKey);
      else next.add(sessionKey);
      return { selectedSessions: next };
    }),

  clearSelection: () =>
    set({ selectionMode: false, selectedSessions: new Set<SessionKey>() }),
}));
