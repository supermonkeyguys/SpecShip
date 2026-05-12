import type { PreviewStatusResponse } from "../../types";
import type { ActiveSession } from "../session/types";
import type { SelectedFileIdentity, WorkspaceSurface } from "../../domains/workspace/types";
import { Canvas } from "../canvas/Canvas";
import { FilePreview } from "../files/FilePreview";
import { PreviewPanel } from "../preview/PreviewPanel";
import { SettingsPanel } from "../settings/SettingsPanel";
import { TaskCreationScreen } from "../task-creation/TaskCreationScreen";

interface Props {
  surface: WorkspaceSurface;
  activeSession: ActiveSession | null;
  selectedFile: SelectedFileIdentity | null;
  fileContent: string | null;
  fileError: string | null;
  previewInfo: PreviewStatusResponse | null;
  onCloseFile: () => void;
  onCloseTransientSurface: () => void;
  onRefreshPreview: (next?: PreviewStatusResponse) => Promise<void> | void;
  onRunStarted: (session: ActiveSession) => Promise<void> | void;
}

export function CenterSurface({
  surface,
  activeSession,
  selectedFile,
  fileContent,
  fileError,
  previewInfo,
  onCloseFile,
  onCloseTransientSurface,
  onRefreshPreview,
  onRunStarted,
}: Props) {
  switch (surface) {
    case "file":
      if (selectedFile) {
        return (
          <FilePreview
            filePath={selectedFile.path}
            content={fileContent}
            error={fileError}
            onClose={onCloseFile}
          />
        );
      }
      return activeSession ? <Canvas /> : <TaskCreationScreen onRunStarted={onRunStarted} />;

    case "settings":
      return <SettingsPanel onBack={onCloseTransientSurface} />;

    case "preview":
      if (activeSession) {
        return (
          <PreviewPanel
            projectId={activeSession.projectId}
            sessionId={activeSession.sessionId}
            info={previewInfo}
            onClose={onCloseTransientSurface}
            onRefresh={onRefreshPreview}
          />
        );
      }
      return <TaskCreationScreen onRunStarted={onRunStarted} />;

    case "canvas":
      return activeSession ? <Canvas /> : <TaskCreationScreen onRunStarted={onRunStarted} />;

    case "new-task":
    default:
      return <TaskCreationScreen onRunStarted={onRunStarted} />;
  }
}
