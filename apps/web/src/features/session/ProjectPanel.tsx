/**
 * session/ProjectPanel.tsx — 左侧 Session 列表（扁平）
 * 所有 session 直接列出，去掉 project 层
 */

import type { FileEntry, PreviewStatusResponse } from "../../types";
import type { ActiveSession } from "./types";
import { useProjectPanelActions } from "./useProjectPanelActions";
import { useProjectPanelModel } from "./useProjectPanelModel";
import { ProjectPanelView } from "./ProjectPanelView";

interface Props {
  activeSession: ActiveSession | null;
  onSelectSession: (session: ActiveSession | null) => Promise<void> | void;
  onSelectFile: (file: FileEntry, projectId: string, sessionId: string) => Promise<void> | void;
  onNewSession: () => void;
  onOpenPreview: () => void;
  onOpenSettings: () => void;
  selectedFilePath?: string;
  previewInfo: PreviewStatusResponse | null;
}

export function ProjectPanel({
  activeSession,
  onSelectSession,
  onSelectFile,
  onNewSession,
  onOpenPreview,
  onOpenSettings,
  selectedFilePath,
  previewInfo,
}: Props) {
  const actions = useProjectPanelActions({
    activeSession,
    sessionRows: [],
    onSelectSession,
    onSelectFile,
    onNewSession,
    onOpenPreview,
    onOpenSettings,
  });

  const model = useProjectPanelModel({
    activeSession,
    selectedFilePath,
    previewInfo,
    deleting: actions.deleting,
  });

  const boundActions = useProjectPanelActions({
    activeSession,
    sessionRows: model.sessionRows,
    onSelectSession,
    onSelectFile,
    onNewSession,
    onOpenPreview,
    onOpenSettings,
  });

  return <ProjectPanelView {...model} {...boundActions} />;
}
