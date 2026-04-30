/**
 * session/ProjectPanel.tsx — 左侧 Session 列表（扁平）
 * 所有 session 直接列出，去掉 project 层
 */

import { useState, useCallback, useMemo } from "react";
import { Button } from "../../components/ui/button";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Separator } from "../../components/ui/separator";
import { cn } from "../../components/ui/utils";
import type { FileEntry } from "../../types";
import type { ActiveSession } from "./types";
import { useWorkspaceController } from "../../domains/workspace/controller";
import { EmptyState } from "../../shared/ui/EmptyState";
import type { PreviewStatusResponse } from "../../types";
import { deleteSession, starSession } from "../../shared/api/projectClient";

interface Props {
  activeSession: ActiveSession | null;
  onSelectSession: (session: ActiveSession) => void;
  onSelectFile: (file: FileEntry, projectId: string, sessionId: string) => void;
  onNewSession: () => void;
  onOpenPreview: () => void;
  selectedFilePath?: string;
  previewInfo: PreviewStatusResponse | null;
}

// 扁平化的 session 记录，带上 projectId
interface FlatSession {
  projectId: string;
  id: string;
  spec: string;
  status: string;
  starred?: boolean;
  createdAt: string;
}

export function ProjectPanel({ activeSession, onSelectSession, onSelectFile, onNewSession, onOpenPreview, selectedFilePath, previewInfo }: Props) {
  const {
    projects,
    sessionFiles,
    selectionMode,
    selectedSessions,
    setSelectionMode,
    toggleSessionSelected,
    clearSelection,
    setProjects,
    setActiveSession,
  } = useWorkspaceController();

  const [deleting, setDeleting] = useState(false);

  // 所有 session 扁平化，按 createdAt 倒序
  const allSessions = useMemo<FlatSession[]>(() => {
    const flat: FlatSession[] = [];
    for (const proj of projects) {
      for (const sess of proj.sessions) {
        flat.push({ projectId: proj.id, ...sess });
      }
    }
    // 最新的在最上面
    flat.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return flat;
  }, [projects]);

  // 批量删除
  const handleBatchDelete = useCallback(async () => {
    if (selectedSessions.size === 0) return;
    if (!confirm(`确认删除 ${selectedSessions.size} 个会话？此操作不可撤销。`)) return;

    setDeleting(true);
    try {
      const toDelete = allSessions.filter((s) => selectedSessions.has(s.id));
      await Promise.all(toDelete.map(({ projectId, id }) => deleteSession(projectId, id)));

      setProjects(
        projects.map((p) => ({
          ...p,
          sessions: p.sessions.filter((s) => !selectedSessions.has(s.id)),
        })).filter((p) => p.sessions.length > 0)
      );

      // 若活跃 session 在被删集合中，清除引用
      if (activeSession && selectedSessions.has(activeSession.sessionId)) {
        setActiveSession(null);
      }
      clearSelection();
    } finally {
      setDeleting(false);
    }
  }, [selectedSessions, allSessions, projects, setProjects, clearSelection, activeSession, setActiveSession]);

  // 单个删除
  const handleDeleteSession = useCallback(async (e: React.MouseEvent, projectId: string, sessionId: string) => {
    e.stopPropagation();
    if (!confirm("确认删除此会话？此操作不可撤销。")) return;
    await deleteSession(projectId, sessionId);
    setProjects(
      projects.map((p) =>
        p.id === projectId
          ? { ...p, sessions: p.sessions.filter((s) => s.id !== sessionId) }
          : p
      ).filter((p) => p.sessions.length > 0)
    );
    // 若删的是当前活跃 session，清除引用，防止后续 resume/retry 报 400
    if (activeSession?.sessionId === sessionId) {
      setActiveSession(null);
    }
  }, [projects, setProjects, activeSession, setActiveSession]);

  // 收藏 / 取消收藏
  const handleToggleStar = useCallback(async (e: React.MouseEvent, projectId: string, sessionId: string, currentStarred: boolean) => {
    e.stopPropagation();
    await starSession(projectId, sessionId, !currentStarred);
    setProjects(
      projects.map((p) =>
        p.id === projectId
          ? { ...p, sessions: p.sessions.map((s) => s.id === sessionId ? { ...s, starred: !currentStarred } : s) }
          : p
      )
    );
  }, [projects, setProjects]);

  return (
    <aside className="flex h-full flex-col border-r border-gray-200 bg-gray-50 text-xs" aria-label="Projects and sessions">
      {/* Header */}
      <div className="flex items-center justify-between gap-1 bg-white px-3 py-2">
        <span className="font-semibold uppercase tracking-wider text-gray-500 text-xs">Sessions</span>
        <div className="flex items-center gap-1">
          {selectionMode ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                className="h-6 px-2 text-xs"
                onClick={handleBatchDelete}
                disabled={selectedSessions.size === 0 || deleting}
              >
                删除{selectedSessions.size > 0 ? `(${selectedSessions.size})` : ""}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-6 px-2 text-xs"
                onClick={() => clearSelection()}
              >
                取消
              </Button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="h-6 px-1.5 text-xs rounded border border-gray-200 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                onClick={() => setSelectionMode(true)}
                title="批量管理"
              >
                ☰
              </button>
              <button
                type="button"
                className="h-6 px-1.5 text-xs rounded border border-gray-200 text-gray-500 hover:bg-gray-100 disabled:opacity-40"
                onClick={onOpenPreview}
                disabled={!activeSession || !previewInfo?.supported}
                title={previewInfo?.supported ? "Open preview" : previewInfo?.reason ?? "No preview available"}
              >
                ⬡
              </button>
              <Button type="button" size="sm" className="h-6 px-2 text-xs" onClick={onNewSession}>
                + New
              </Button>
            </>
          )}
        </div>
      </div>

      <Separator />

      <ScrollArea className="flex-1">
        <div className="py-1">
          {allSessions.length === 0 ? (
            <EmptyState title="No sessions yet" />
          ) : (
            allSessions.map((sess) => {
              const isActive = activeSession?.sessionId === sess.id;
              const isSelected = selectedSessions.has(sess.id);
              const isStarred = sess.starred ?? false;

              return (
                <div
                  key={sess.id}
                  className={cn(
                    "group flex items-center gap-1 rounded-none py-1.5 pl-3 pr-2 text-xs",
                    isActive && !selectionMode
                      ? "border-l-2 border-blue-500 bg-blue-50 text-blue-700"
                      : "border-l-2 border-transparent text-gray-600",
                    isSelected && "bg-blue-50",
                    "hover:bg-gray-100"
                  )}
                >
                  {/* Checkbox（多选模式）*/}
                  {selectionMode && (
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSessionSelected(sess.id)}
                      className="h-3 w-3 flex-shrink-0 cursor-pointer accent-blue-500"
                      onClick={(e) => e.stopPropagation()}
                    />
                  )}

                  {/* Session 主体 */}
                  <button
                    type="button"
                    className="flex flex-1 items-center gap-2 overflow-hidden text-left"
                    onClick={() => {
                      if (selectionMode) {
                        toggleSessionSelected(sess.id);
                      } else {
                        onSelectSession({ projectId: sess.projectId, sessionId: sess.id, spec: sess.spec });
                      }
                    }}
                  >
                    <StatusDot status={sess.status} />
                    <span className="flex-1 truncate">{sess.spec.split('\n')[0].slice(0, 40)}</span>
                  </button>

                  {/* 操作按钮（非多选模式，hover 显示）*/}
                  {!selectionMode && (
                    <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                      <span
                        role="button"
                        title={isStarred ? "取消收藏" : "收藏"}
                        className={cn(
                          "flex h-4 w-4 items-center justify-center rounded text-xs",
                          isStarred ? "text-amber-400" : "text-gray-300 hover:text-amber-400"
                        )}
                        onClick={(e) => handleToggleStar(e, sess.projectId, sess.id, isStarred)}
                      >
                        ★
                      </span>
                      <span
                        role="button"
                        title="删除会话"
                        className="flex h-4 w-4 items-center justify-center rounded text-gray-300 hover:text-red-500"
                        onClick={(e) => handleDeleteSession(e, sess.projectId, sess.id)}
                      >
                        ✕
                      </span>
                    </div>
                  )}
                </div>
              );
            })
          )}

          {activeSession && sessionFiles.length > 0 && (
            <>
              <Separator className="my-1" />
              <div className="px-3 py-1.5 font-semibold uppercase tracking-wider text-gray-400">Files</div>
              {sessionFiles.map((f) => {
                const isSelected = selectedFilePath === f.path;
                return (
                  <Button
                    key={f.path}
                    type="button"
                    variant="ghost"
                    onClick={() => onSelectFile(f, activeSession.projectId, activeSession.sessionId)}
                    className={cn(
                      "h-auto w-full justify-start gap-2 rounded-none py-1.5 pl-4 pr-3 text-left text-xs font-normal",
                      isSelected
                        ? "border-l-2 border-blue-400 bg-blue-50 text-blue-700 hover:bg-blue-50 hover:text-blue-700"
                        : "text-gray-600"
                    )}
                  >
                    <span className="flex-shrink-0 text-green-600">📄</span>
                    <span className="flex-1 truncate font-mono">{f.path}</span>
                  </Button>
                );
              })}
            </>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    running: "bg-amber-400 animate-pulse",
    done: "bg-green-500",
    failed: "bg-red-500",
    interrupted: "bg-gray-400",
  };
  return <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${colors[status] ?? "bg-gray-300"}`} />;
}
