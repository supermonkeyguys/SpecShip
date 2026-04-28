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

export default function App() {
  useSSE();

  const runStatus = useExecutionStore(selectHeaderRunStatus);
  const {
    activeSession, resumeInfo,
    setActiveSession, activateStartedSession, handleResume, handleNewSession, dismissResume,
  } = useSession();
  const { selectedFile, fileContent, handleFileSelect, handleClose } = useFilePreview();

  useEffect(() => {
    if (!selectedFile) return;
    if (!activeSession) {
      handleClose();
      return;
    }
    if (
      selectedFile.projectId !== activeSession.projectId ||
      selectedFile.sessionId !== activeSession.sessionId
    ) {
      handleClose();
    }
  }, [
    activeSession?.projectId,
    activeSession?.sessionId,
    selectedFile?.projectId,
    selectedFile?.sessionId,
    handleClose,
    selectedFile,
  ]);

  return (
    <div className="h-screen w-screen flex flex-col bg-white text-gray-900 overflow-hidden">
      {/* 顶部状态栏 */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-white flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm">⚓ Shipyard</span>
          <span className="text-gray-400 text-xs">v0.4</span>
        </div>
        <StatusBadge status={runStatus} />
      </header>

      {/* 断点恢复提示 */}
      {resumeInfo && (
        <ResumeBar
          info={resumeInfo}
          onResume={handleResume}
          onDismiss={dismissResume}
        />
      )}

      {/* 三栏主体 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左：Project/Session 列表 */}
        <div className="w-52 flex-shrink-0">
          <ProjectPanel
            activeSession={activeSession}
            onSelectSession={setActiveSession}
            onSelectFile={handleFileSelect}
            onNewSession={handleNewSession}
            selectedFilePath={selectedFile?.file.path}
          />
        </div>

        {/* 中：画板 或 文件预览 */}
        <div className="flex-1 overflow-hidden">
          {selectedFile ? (
            <FilePreview
              file={selectedFile.file}
              content={fileContent}
              onClose={handleClose}
            />
          ) : (
            <Canvas />
          )}
        </div>

        {/* 右：Chat */}
        <div className="w-80 flex-shrink-0">
          <Chat
            sessionId={activeSession?.sessionId}
            onRunStarted={async (session) => {
              await activateStartedSession(session);
              handleClose();
            }}
            onResumeRequested={handleResume}
          />
        </div>
      </div>
    </div>
  );
}
