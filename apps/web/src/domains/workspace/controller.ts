import { useEffect } from "react";
import { useWorkspaceStore } from "./store";
import { fetchProjects } from "../../shared/api/projectClient";
import { fetchSessionFiles } from "../../shared/api/fileClient";
import { fetchSessionPreview } from "../../shared/api/previewClient";

export function useWorkspaceSync() {
  const activeSession = useWorkspaceStore((state) => state.activeSession);
  const setProjects = useWorkspaceStore((state) => state.setProjects);
  const setSessionFiles = useWorkspaceStore((state) => state.setSessionFiles);
  const setPreviewInfo = useWorkspaceStore((state) => state.setPreviewInfo);

  const activeProjectId = activeSession?.projectId ?? null;
  const activeSessionId = activeSession?.sessionId ?? null;

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
}
