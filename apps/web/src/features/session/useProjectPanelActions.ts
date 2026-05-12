import { useCallback, useState } from "react";
import { useWorkspaceStore } from "../../domains/workspace/store";
import { useExecutionStore } from "../../domains/execution/store";
import { deleteSession, deleteProject, starSession } from "../../shared/api/projectClient";
import type { FileEntry } from "../../types";
import type { ActiveSession } from "./types";
import { isSameSession } from "./types";
import type { FileRowVM, SessionRowVM } from "./projectPanel.types";

interface Args {
  activeSession: ActiveSession | null;
  sessionRows: SessionRowVM[];
  onSelectSession: (session: ActiveSession | null) => Promise<void> | void;
  onSelectFile: (file: FileEntry, projectId: string, sessionId: string) => Promise<void> | void;
  onNewSession: () => void;
  onOpenPreview: () => void;
  onOpenSettings: () => void;
}

export function useProjectPanelActions({
  activeSession,
  sessionRows,
  onSelectSession,
  onSelectFile,
  onNewSession,
  onOpenPreview,
  onOpenSettings,
}: Args) {
  const selectedSessions = useWorkspaceStore((state) => state.selectedSessions);
  const setProjects = useWorkspaceStore((state) => state.setProjects);
  const setSelectionMode = useWorkspaceStore((state) => state.setSelectionMode);
  const toggleSessionSelected = useWorkspaceStore((state) => state.toggleSessionSelected);
  const clearSelection = useWorkspaceStore((state) => state.clearSelection);
  const projects = useWorkspaceStore((state) => state.projects);
  const [deleting, setDeleting] = useState(false);

  const onEnterSelectionMode = useCallback(() => setSelectionMode(true), [setSelectionMode]);
  const onCancelSelectionMode = useCallback(() => clearSelection(), [clearSelection]);

  const onDeleteSelected = useCallback(async () => {
    if (selectedSessions.size === 0) return;
    if (!confirm(`确认删除 ${selectedSessions.size} 个会话？此操作不可撤销。`)) return;

    setDeleting(true);
    try {
      const toDelete = sessionRows.filter((row) => selectedSessions.has(row.key));
      await Promise.all(toDelete.map(({ projectId, sessionId }) => deleteSession(projectId, sessionId)));

      // 找出 session 全部被删的 project，一并删除 project 目录
      const deletedByProject = new Map<string, number>();
      for (const row of toDelete) {
        deletedByProject.set(row.projectId, (deletedByProject.get(row.projectId) ?? 0) + 1);
      }
      const projectsToDelete = projects.filter((p) =>
        (deletedByProject.get(p.id) ?? 0) >= p.sessions.length
      );
      await Promise.all(projectsToDelete.map((p) => deleteProject(p.id)));

      setProjects(
        projects.map((p) => ({
          ...p,
          sessions: p.sessions.filter((s) => !selectedSessions.has(`${p.id}:${s.id}` as const)),
        })).filter((p) => p.sessions.length > 0)
      );

      for (const row of toDelete) {
        useExecutionStore.getState().clearSession({ projectId: row.projectId, sessionId: row.sessionId });
      }

      if (activeSession && toDelete.some((row) => isSameSession(activeSession, { projectId: row.projectId, sessionId: row.sessionId }))) {
        await onSelectSession(null);
      }
      clearSelection();
    } finally {
      setDeleting(false);
    }
  }, [selectedSessions, sessionRows, projects, setProjects, activeSession, onSelectSession, clearSelection]);

  const onDeleteSession = useCallback(async (row: SessionRowVM) => {
    if (!confirm("确认删除此会话？此操作不可撤销。")) return;
    await deleteSession(row.projectId, row.sessionId);

    const project = projects.find((p) => p.id === row.projectId);
    if (project && project.sessions.length <= 1) {
      await deleteProject(row.projectId);
    }

    setProjects(
      projects.map((p) =>
        p.id === row.projectId
          ? { ...p, sessions: p.sessions.filter((s) => s.id !== row.sessionId) }
          : p
      ).filter((p) => p.sessions.length > 0)
    );
    useExecutionStore.getState().clearSession({ projectId: row.projectId, sessionId: row.sessionId });
    if (activeSession && isSameSession(activeSession, { projectId: row.projectId, sessionId: row.sessionId })) {
      await onSelectSession(null);
    }
  }, [projects, setProjects, activeSession, onSelectSession]);

  const onToggleStar = useCallback(async (row: SessionRowVM) => {
    await starSession(row.projectId, row.sessionId, !row.starred);
    setProjects(
      projects.map((p) =>
        p.id === row.projectId
          ? { ...p, sessions: p.sessions.map((s) => s.id === row.sessionId ? { ...s, starred: !row.starred } : s) }
          : p
      )
    );
  }, [projects, setProjects]);

  const onSelectSessionRow = useCallback(async (row: SessionRowVM) => {
    if (useWorkspaceStore.getState().selectionMode) {
      toggleSessionSelected(row.key);
      return;
    }
    await onSelectSession({ projectId: row.projectId, sessionId: row.sessionId });
  }, [toggleSessionSelected, onSelectSession]);

  const onToggleSessionSelection = useCallback((row: SessionRowVM) => {
    toggleSessionSelected(row.key);
  }, [toggleSessionSelected]);

  const onSelectFileRow = useCallback(async (row: FileRowVM) => {
    if (!activeSession) return;
    await onSelectFile(row.entry, activeSession.projectId, activeSession.sessionId);
  }, [activeSession, onSelectFile]);

  return {
    deleting,
    onOpenPreview,
    onOpenSettings,
    onNewSession,
    onEnterSelectionMode,
    onCancelSelectionMode,
    onDeleteSelected,
    onSelectSession: onSelectSessionRow,
    onToggleSessionSelection,
    onToggleStar,
    onDeleteSession,
    onSelectFile: onSelectFileRow,
  };
}
