/**
 * App.tsx — 三栏布局入口
 *
 * 职责：只管布局和组合。
 * 业务状态全部委托给各 feature 的 hook。
 */

import { useEffect, useState } from "react";
import { useSSE } from "./hooks/useSSE";
import { useExecutionStore } from "./domains/execution/store";
import { selectHeaderRunStatus } from "./domains/execution/selectors";
import { useSession } from "./features/session/useSession";
import { useFilePreview } from "./features/files/useFilePreview";
import { ProjectPanel } from "./features/session/ProjectPanel";
import { ResumeBar } from "./features/session/ResumeBar";
import { Canvas } from "./features/canvas/Canvas";
import { FilePreview } from "./features/files/FilePreview";
import { PreviewPanel } from "./features/preview/PreviewPanel";
import { Chat } from "./features/chat/Chat";
import { StatusBadge } from "./components/StatusBadge";
import { useWorkspaceStore } from "./domains/workspace/store";
import { fetchSessionPreview } from "./shared/api/previewClient";
import type { ActiveSession } from "./features/session/types";

export default function App() {
  useSSE();

  const runStatus = useExecutionStore(selectHeaderRunStatus);
  const {
    activeSession, resumeInfo,
    setActiveSession, activateStartedSession, handleResume, handleNewSession, dismissResume,
  } = useSession();
  const { selectedFile, fileContent, fileError, handleFileSelect, handleClose } = useFilePreview();
  const previewInfo = useWorkspaceStore((state) => state.previewInfo);
  const setPreviewInfo = useWorkspaceStore((state) => state.setPreviewInfo);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const clearSelectedFileIfSessionMismatch = useWorkspaceStore(
    (state) => state.clearSelectedFileIfSessionMismatch
  );

  useEffect(() => {
    clearSelectedFileIfSessionMismatch(activeSession);
  }, [activeSession, clearSelectedFileIfSessionMismatch]);

  const handleSelectSession = async (session: ActiveSession | null) => {
    setIsPreviewOpen(false);
    await setActiveSession(session);
  };

  const handleActivateStartedSession = async (session: ActiveSession) => {
    setIsPreviewOpen(false);
    await activateStartedSession(session);
    handleClose();
  };

  const handleResumeSession = async () => {
    setIsPreviewOpen(false);
    await handleResume();
  };

  const handleCreateNewSession = () => {
    setIsPreviewOpen(false);
    handleNewSession();
  };

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
            onOpenPreview={() => {
              handleClose();
              setIsPreviewOpen(true);
            }}
            selectedFilePath={selectedFile?.path}
            previewInfo={previewInfo}
          />
        </div>

        <section className="flex-1 overflow-hidden" aria-label="Canvas or file preview">
          {selectedFile ? (
            <FilePreview
              filePath={selectedFile.path}
              content={fileContent}
              error={fileError}
              onClose={handleClose}
            />
          ) : isPreviewOpen ? (
            <PreviewPanel
              projectId={activeSession?.projectId ?? ""}
              sessionId={activeSession?.sessionId ?? ""}
              info={previewInfo}
              onClose={() => setIsPreviewOpen(false)}
              onRefresh={refreshPreview}
            />
          ) : (
            <Canvas />
          )}
        </section>

        <aside className="w-80 flex-shrink-0" aria-label="Chat and logs">
          <Chat
            sessionId={activeSession?.sessionId}
            onRunStarted={handleActivateStartedSession}
            onResumeRequested={handleResumeSession}
          />
        </aside>
      </main>
    </div>
  );
}
