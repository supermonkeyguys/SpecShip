import { useEffect } from "react";
import { useWorkspaceStore } from "./store";
import { fetchProjects } from "../../shared/api/projectClient";
import { fetchSessionFiles } from "../../shared/api/fileClient";
import { fetchSessionPreview } from "../../shared/api/previewClient";

export function useWorkspaceController() {
  const activeSession = useWorkspaceStore((state) => state.activeSession);
  const selectedFile = useWorkspaceStore((state) => state.selectedFile);
  const resumeInfo = useWorkspaceStore((state) => state.resumeInfo);
  const projects = useWorkspaceStore((state) => state.projects);
  const expandedProjectId = useWorkspaceStore((state) => state.expandedProjectId);
  const sessionFiles = useWorkspaceStore((state) => state.sessionFiles);
  const previewInfo = useWorkspaceStore((state) => state.previewInfo);

  const setActiveSession = useWorkspaceStore((state) => state.setActiveSession);
  const setSelectedFile = useWorkspaceStore((state) => state.setSelectedFile);
  const setResumeInfo = useWorkspaceStore((state) => state.setResumeInfo);
  const setProjects = useWorkspaceStore((state) => state.setProjects);
  const setExpandedProjectId = useWorkspaceStore((state) => state.setExpandedProjectId);
  const setSessionFiles = useWorkspaceStore((state) => state.setSessionFiles);
  const setPreviewInfo = useWorkspaceStore((state) => state.setPreviewInfo);
  const clearSelectedFileIfSessionMismatch = useWorkspaceStore(
    (state) => state.clearSelectedFileIfSessionMismatch
  );
  const selectionMode = useWorkspaceStore((state) => state.selectionMode);
  const selectedSessions = useWorkspaceStore((state) => state.selectedSessions);
  const activeProjectId = activeSession?.projectId ?? null;
  const activeSessionId = activeSession?.sessionId ?? null;
  const setSelectionMode = useWorkspaceStore((state) => state.setSelectionMode);
  const toggleSessionSelected = useWorkspaceStore((state) => state.toggleSessionSelected);
  const clearSelection = useWorkspaceStore((state) => state.clearSelection);

  useEffect(() => {
    const load = () => {
      fetchProjects()
        .then((data) => setProjects(data.projects ?? []))
        .catch(() => {});
    };

    load();
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [setProjects]);

  useEffect(() => {
    if (!activeProjectId || !activeSessionId) {
      setSessionFiles([]);
      setPreviewInfo(null);
      return;
    }

    const load = () => {
      fetchSessionFiles(activeProjectId, activeSessionId)
        .then((data) => setSessionFiles(data.files ?? []))
        .catch(() => {});

      fetchSessionPreview(activeProjectId, activeSessionId)
        .then((data) => setPreviewInfo(data))
        .catch(() => setPreviewInfo({ ok: false, supported: false, kind: "none", reason: "Failed to load preview status." }));
    };

    load();
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [activeProjectId, activeSessionId, setPreviewInfo, setSessionFiles]);

  return {
    activeSession,
    selectedFile,
    resumeInfo,
    projects,
    expandedProjectId,
    sessionFiles,
    previewInfo,
    selectionMode,
    selectedSessions,
    setActiveSession,
    setSelectedFile,
    setResumeInfo,
    setExpandedProjectId,
    clearSelectedFileIfSessionMismatch,
    setSelectionMode,
    toggleSessionSelected,
    clearSelection,
    setProjects,
  };
}
