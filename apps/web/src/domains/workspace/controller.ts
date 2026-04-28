import { useEffect } from "react";
import { useWorkspaceStore } from "./store";
import { fetchProjects } from "../../shared/api/projectClient";
import { fetchSessionFiles } from "../../shared/api/fileClient";

export function useWorkspaceController() {
  const activeSession = useWorkspaceStore((state) => state.activeSession);
  const selectedFile = useWorkspaceStore((state) => state.selectedFile);
  const resumeInfo = useWorkspaceStore((state) => state.resumeInfo);
  const projects = useWorkspaceStore((state) => state.projects);
  const expandedProjectId = useWorkspaceStore((state) => state.expandedProjectId);
  const sessionFiles = useWorkspaceStore((state) => state.sessionFiles);

  const setActiveSession = useWorkspaceStore((state) => state.setActiveSession);
  const setSelectedFile = useWorkspaceStore((state) => state.setSelectedFile);
  const setResumeInfo = useWorkspaceStore((state) => state.setResumeInfo);
  const setProjects = useWorkspaceStore((state) => state.setProjects);
  const setExpandedProjectId = useWorkspaceStore((state) => state.setExpandedProjectId);
  const setSessionFiles = useWorkspaceStore((state) => state.setSessionFiles);
  const clearSelectedFileIfSessionMismatch = useWorkspaceStore(
    (state) => state.clearSelectedFileIfSessionMismatch
  );

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
    if (!activeSession) {
      setSessionFiles([]);
      return;
    }

    const { projectId, sessionId } = activeSession;
    const load = () => {
      fetchSessionFiles(projectId, sessionId)
        .then((data) => setSessionFiles(data.files ?? []))
        .catch(() => {});
    };

    load();
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [activeSession?.projectId, activeSession?.sessionId, setSessionFiles]);

  return {
    activeSession,
    selectedFile,
    resumeInfo,
    projects,
    expandedProjectId,
    sessionFiles,
    setActiveSession,
    setSelectedFile,
    setResumeInfo,
    setExpandedProjectId,
    clearSelectedFileIfSessionMismatch,
  };
}
