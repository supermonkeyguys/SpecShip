import { create } from "zustand";
import type { ActiveSession } from "../../features/session/types";
import type { StatusResponse, ProjectsResponse, FileEntry } from "../../types";
import type { SelectedFileIdentity, WorkspaceState } from "./types";

interface WorkspaceStore extends WorkspaceState {
  setActiveSession: (session: ActiveSession | null) => void;
  setSelectedFile: (file: SelectedFileIdentity | null) => void;
  setResumeInfo: (resumeInfo: StatusResponse | null) => void;
  setProjects: (projects: ProjectsResponse["projects"]) => void;
  setExpandedProjectId: (projectId: string | null) => void;
  setSessionFiles: (files: FileEntry[]) => void;
  clearSelectedFileIfSessionMismatch: (session: ActiveSession | null) => void;
}

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  activeSession: null,
  selectedFile: null,
  resumeInfo: null,
  projects: [],
  expandedProjectId: null,
  sessionFiles: [],

  setActiveSession: (session) => set({ activeSession: session }),
  setSelectedFile: (file) => set({ selectedFile: file }),
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

  clearSelectedFileIfSessionMismatch: (session) =>
    set((state) => {
      if (!state.selectedFile) return state;
      if (!session) return { selectedFile: null };
      if (
        state.selectedFile.projectId !== session.projectId ||
        state.selectedFile.sessionId !== session.sessionId
      ) {
        return { selectedFile: null };
      }
      return state;
    }),
}));
