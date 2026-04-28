/**
 * App.tsx — 三栏布局入口
 *
 * 职责：只管布局和组合。
 * 业务状态全部委托给各 feature 的 hook。
 */

import { useEffect } from "react";
import { useSSE } from "./hooks/useSSE";
import { useExecutionStore } from "./domains/execution/store";
import { selectHeaderRunStatus } from "./domains/execution/selectors";
import { useSession } from "./features/session/useSession";
import { useFilePreview } from "./features/files/useFilePreview";
import { ProjectPanel } from "./features/session/ProjectPanel";
import { ResumeBar } from "./features/session/ResumeBar";
import { Canvas } from "./features/canvas/Canvas";
import { FilePreview } from "./features/files/FilePreview";
import { Chat } from "./features/chat/Chat";
import { StatusBadge } from "./components/StatusBadge";
import { useWorkspaceStore } from "./domains/workspace/store";

export default function App() {
  useSSE();

  const runStatus = useExecutionStore(selectHeaderRunStatus);
  const {
    activeSession, resumeInfo,
    setActiveSession, activateStartedSession, handleResume, handleNewSession, dismissResume,
  } = useSession();
  const { selectedFile, fileContent, fileError, handleFileSelect, handleClose } = useFilePreview();
  const clearSelectedFileIfSessionMismatch = useWorkspaceStore(
    (state) => state.clearSelectedFileIfSessionMismatch
  );

  useEffect(() => {
    clearSelectedFileIfSessionMismatch(activeSession);
  }, [
    activeSession?.projectId,
    activeSession?.sessionId,
    clearSelectedFileIfSessionMismatch,
  ]);

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
          onResume={handleResume}
          onDismiss={dismissResume}
        />
      )}

      <main className="flex-1 flex overflow-hidden" aria-label="Workspace layout">
        <div className="w-52 flex-shrink-0">
          <ProjectPanel
            activeSession={activeSession}
            onSelectSession={setActiveSession}
            onSelectFile={handleFileSelect}
            onNewSession={handleNewSession}
            selectedFilePath={selectedFile?.path}
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
          ) : (
            <Canvas />
          )}
        </section>

        <aside className="w-80 flex-shrink-0" aria-label="Chat and logs">
          <Chat
            sessionId={activeSession?.sessionId}
            onRunStarted={async (session) => {
              await activateStartedSession(session);
              handleClose();
            }}
            onResumeRequested={handleResume}
          />
        </aside>
      </main>
    </div>
  );
}
