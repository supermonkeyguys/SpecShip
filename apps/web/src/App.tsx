/**
 * App.tsx — 三栏布局入口
 *
 * 职责：只管布局和组合。
 * 业务状态全部委托给各 feature 的 hook。
 */

import { useEffect } from "react";
import { useSSE } from "./hooks/useSSE";
import { useExecutionStore } from "./domains/execution/store";
import { useSession } from "./features/session/useSession";
import { useWorkspaceSync } from "./domains/workspace/controller";
import { useFilePreview } from "./features/files/useFilePreview";
import { ProjectPanel } from "./features/session/ProjectPanel";
import { useWorkspaceShell } from "./features/workspace/useWorkspaceShell";
import { ResumeBar } from "./features/session/ResumeBar";
import { Chat } from "./features/chat/Chat";
import { CenterSurface } from "./features/workspace/CenterSurface";
import { StatusBadge } from "./components/StatusBadge";

import { useWorkspaceStore } from "./domains/workspace/store";
import { fetchSessionPreview } from "./shared/api/previewClient";
import { selectHeaderRunStatus } from "./domains/session/selectors";
import { selectShouldShowExecutionRail, selectSurface } from "./domains/workspace/selectors";

export default function App() {
  useSSE();
  useWorkspaceSync();

  const activeSession = useWorkspaceStore((state) => state.activeSession);
  const surface = useWorkspaceStore(selectSurface);
  const shouldShowExecutionRail = useWorkspaceStore(selectShouldShowExecutionRail);
  const previewInfo = useWorkspaceStore((state) => state.previewInfo);
  const setPreviewInfo = useWorkspaceStore((state) => state.setPreviewInfo);
  const runStatus = useExecutionStore((execution) =>
    selectHeaderRunStatus(useWorkspaceStore.getState(), execution)
  );
  const {
    resumeInfo,
    setActiveSession, activateStartedSession, handleResume, handleNewSession, dismissResume,
  } = useSession();
  const { selectedFile, fileContent, fileError, handleFileSelect, handleClose } = useFilePreview();
  const {
    handleCloseTransientSurface,
    handleSelectSession,
    handleActivateStartedSession,
    handleResumeSession,
    handleCreateNewSession,
    handleOpenPreview,
    handleOpenSettings,
  } = useWorkspaceShell({
    onSelectSession: setActiveSession,
    onActivateStartedSession: activateStartedSession,
    onResumeSession: handleResume,
    onCreateNewSession: handleNewSession,
    closeFilePreview: handleClose,
  });

  const refreshPreview = async (next?: import("./types").PreviewStatusResponse) => {
    if (next) {
      setPreviewInfo(next);
      return;
    }
    if (!activeSession) {
      setPreviewInfo(null);
      return;
    }
    try {
      const data = await fetchSessionPreview(activeSession.projectId, activeSession.sessionId);
      setPreviewInfo(data);
    } catch {
      setPreviewInfo({ ok: false, supported: false, kind: "none", reason: "Failed to load preview status." });
    }
  };

  useEffect(() => {
    refreshPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSession?.projectId, activeSession?.sessionId]);

  useEffect(() => {
    if (runStatus === "done" || runStatus === "failed") {
      refreshPreview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runStatus]);

  return (
    <div className="h-screen w-screen flex flex-col bg-white text-gray-900 overflow-hidden">
      <header className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-white flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm">⚓ Shipyard</span>
          <span className="text-gray-400 text-xs">v0.4</span>
        </div>
        <StatusBadge status={runStatus} />
      </header>

      {resumeInfo && (
        <ResumeBar
          info={resumeInfo}
          onResume={handleResumeSession}
          onDismiss={dismissResume}
        />
      )}

      <main className="flex-1 flex overflow-hidden" aria-label="Workspace layout">
        <div className="w-64 flex-shrink-0">
          <ProjectPanel
            activeSession={activeSession}
            onSelectSession={handleSelectSession}
            onSelectFile={handleFileSelect}
            onNewSession={handleCreateNewSession}
            onOpenPreview={handleOpenPreview}
            onOpenSettings={handleOpenSettings}
            selectedFilePath={selectedFile?.path}
            previewInfo={previewInfo}
          />
        </div>

        <section className="flex-1 overflow-hidden" aria-label="Workspace center surface">
          <CenterSurface
            surface={surface}
            activeSession={activeSession}
            selectedFile={selectedFile}
            fileContent={fileContent}
            fileError={fileError}
            previewInfo={previewInfo}
            onCloseFile={handleClose}
            onCloseTransientSurface={handleCloseTransientSurface}
            onRefreshPreview={refreshPreview}
            onRunStarted={handleActivateStartedSession}
          />
        </section>

        {shouldShowExecutionRail ? (
          <aside className="w-80 flex-shrink-0" aria-label="Chat and logs">
            <Chat
              sessionRef={activeSession ?? undefined}
              onRunStarted={handleActivateStartedSession}
              onResumeRequested={handleResumeSession}
            />
          </aside>
        ) : null}
      </main>
    </div>
  );
}
