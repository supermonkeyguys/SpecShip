import { useCallback } from "react";
import type { ActiveSession } from "../session/types";
import { useWorkspaceStore } from "../../domains/workspace/store";
import { selectSurface } from "../../domains/workspace/selectors";

interface Args {
  onSelectSession: (session: ActiveSession | null) => Promise<void> | void;
  onActivateStartedSession: (session: ActiveSession) => Promise<void> | void;
  onResumeSession: () => Promise<void> | void;
  onCreateNewSession: () => void;
  closeFilePreview: () => void;
}

export function useWorkspaceShell({
  onSelectSession,
  onActivateStartedSession,
  onResumeSession,
  onCreateNewSession,
  closeFilePreview,
}: Args) {
  const surface = useWorkspaceStore(selectSurface);
  const setSurface = useWorkspaceStore((state) => state.setSurface);
  const showPrimarySurface = useWorkspaceStore((state) => state.showPrimarySurface);

  const handleCloseTransientSurface = useCallback(() => {
    showPrimarySurface();
  }, [showPrimarySurface]);

  const handleSelectSession = useCallback(async (session: ActiveSession | null) => {
    handleCloseTransientSurface();
    await onSelectSession(session);
  }, [handleCloseTransientSurface, onSelectSession]);

  const handleActivateStartedSession = useCallback(async (session: ActiveSession) => {
    handleCloseTransientSurface();
    await onActivateStartedSession(session);
    closeFilePreview();
  }, [handleCloseTransientSurface, onActivateStartedSession, closeFilePreview]);

  const handleResumeSession = useCallback(async () => {
    handleCloseTransientSurface();
    await onResumeSession();
  }, [handleCloseTransientSurface, onResumeSession]);

  const handleCreateNewSession = useCallback(() => {
    handleCloseTransientSurface();
    onCreateNewSession();
  }, [handleCloseTransientSurface, onCreateNewSession]);

  const handleOpenPreview = useCallback(() => {
    closeFilePreview();
    setSurface("preview");
  }, [closeFilePreview, setSurface]);

  const handleOpenSettings = useCallback(() => {
    closeFilePreview();
    setSurface("settings");
  }, [closeFilePreview, setSurface]);

  return {
    surface,
    handleCloseTransientSurface,
    handleSelectSession,
    handleActivateStartedSession,
    handleResumeSession,
    handleCreateNewSession,
    handleOpenPreview,
    handleOpenSettings,
  };
}
