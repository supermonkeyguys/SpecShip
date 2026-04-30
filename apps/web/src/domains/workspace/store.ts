import { create } from "zustand";
import type { ActiveSession } from "../../features/session/types";
import type { StatusResponse, ProjectsResponse, FileEntry, PreviewStatusResponse } from "../../types";
import type { SelectedFileIdentity, WorkspaceState } from "./types";

interface WorkspaceStore extends WorkspaceState {
  setActiveSession: (session: ActiveSession | null) => void;
  setSelectedFile: (file: SelectedFileIdentity | null) => void;
  setResumeInfo: (resumeInfo: StatusResponse | null) => void;
  setProjects: (projects: ProjectsResponse["projects"]) => void;
  setExpandedProjectId: (projectId: string | null) => void;
  setSessionFiles: (files: FileEntry[]) => void;
  setPreviewInfo: (previewInfo: PreviewStatusResponse | null) => void;
  clearSelectedFileIfSessionMismatch: (session: ActiveSession | null) => void;
  // selection
  setSelectionMode: (on: boolean) => void;
  toggleSessionSelected: (sessionId: string) => void;
  clearSelection: () => void;
}

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  activeSession: null,
  selectedFile: null,
  resumeInfo: null,
  projects: [],
  expandedProjectId: null,
  sessionFiles: [],
  previewInfo: null,
  selectionMode: false,
  selectedSessions: new Set<string>(),

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
  setPreviewInfo: (previewInfo) => set({ previewInfo }),

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

  setSelectionMode: (on) =>
    set({ selectionMode: on, selectedSessions: new Set<string>() }),

  toggleSessionSelected: (sessionId) =>
    set((state) => {
      const next = new Set(state.selectedSessions);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return { selectedSessions: next };
    }),

  clearSelection: () =>
    set({ selectionMode: false, selectedSessions: new Set<string>() }),
}));
