import type { FileEntry, PreviewStatusResponse } from "../../types";
import type { ActiveSession, SessionKey } from "./types";

export interface SessionRowVM {
  key: SessionKey;
  projectId: string;
  sessionId: string;
  title: string;
  spec: string;
  status: string;
  starred: boolean;
  createdAt: string;
  isActive: boolean;
  isSelected: boolean;
}

export interface FileRowVM {
  entry: FileEntry;
  isSelected: boolean;
}

export interface ProjectPanelModel {
  activeSession: ActiveSession | null;
  sessionRows: SessionRowVM[];
  fileRows: FileRowVM[];
  selectionMode: boolean;
  selectedCount: number;
  deleting: boolean;
  canEnterSelectionMode: boolean;
  previewInfo: PreviewStatusResponse | null;
}

export interface ProjectPanelViewProps extends ProjectPanelModel {
  onOpenSettings: () => void;
  onOpenPreview: () => void;
  onNewSession: () => void;
  onEnterSelectionMode: () => void;
  onCancelSelectionMode: () => void;
  onDeleteSelected: () => Promise<void> | void;
  onSelectSession: (row: SessionRowVM) => Promise<void> | void;
  onToggleSessionSelection: (row: SessionRowVM) => void;
  onToggleStar: (row: SessionRowVM) => Promise<void> | void;
  onDeleteSession: (row: SessionRowVM) => Promise<void> | void;
  onSelectFile: (row: FileRowVM) => Promise<void> | void;
}
