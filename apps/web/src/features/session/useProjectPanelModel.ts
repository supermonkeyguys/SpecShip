import { useMemo } from "react";
import { useWorkspaceStore } from "../../domains/workspace/store";
import {
  selectFlatSessions,
  selectSelectedSessionCount,
  selectSelectedSessions,
  selectSelectionMode,
  selectSessionFiles,
} from "../../domains/workspace/selectors";
import type { PreviewStatusResponse } from "../../types";
import type { ActiveSession } from "./types";
import { isSameSession } from "./types";
import type { ProjectPanelModel } from "./projectPanel.types";

interface Args {
  activeSession: ActiveSession | null;
  selectedFilePath?: string;
  previewInfo: PreviewStatusResponse | null;
  deleting: boolean;
}

export function useProjectPanelModel({ activeSession, selectedFilePath, previewInfo, deleting }: Args): ProjectPanelModel {
  const flatSessions = useWorkspaceStore(selectFlatSessions);
  const selectionMode = useWorkspaceStore(selectSelectionMode);
  const selectedSessions = useWorkspaceStore(selectSelectedSessions);
  const selectedCount = useWorkspaceStore(selectSelectedSessionCount);
  const sessionFiles = useWorkspaceStore(selectSessionFiles);

  const sessionRows = useMemo(
    () => flatSessions.map((session) => ({
      ...session,
      title: session.spec.split("\n")[0]?.slice(0, 40) ?? "",
      isActive: isSameSession(activeSession, { projectId: session.projectId, sessionId: session.sessionId }),
      isSelected: selectedSessions.has(session.key),
    })),
    [flatSessions, activeSession, selectedSessions]
  );

  const fileRows = useMemo(
    () => sessionFiles.map((entry) => ({ entry, isSelected: selectedFilePath === entry.path })),
    [sessionFiles, selectedFilePath]
  );

  return {
    activeSession,
    sessionRows,
    fileRows,
    selectionMode,
    selectedCount,
    deleting,
    canEnterSelectionMode: sessionRows.length > 0,
    previewInfo,
  };
}
