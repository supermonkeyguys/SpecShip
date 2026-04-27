/**
 * useSession.ts — Session 状态管理
 *
 * 切换 session 时自动从服务端加载历史图状态到 Zustand store，
 * 让 Canvas 和 Log 能展示对应 session 的历史内容。
 */

import { useEffect, useState } from "react";
import { useGraphStore, applySSEEvent } from "../../store/graph";
import { fetchJSON } from "../../utils/fetchJSON";
import type { StatusResponse, NodeStatus } from "../../../../server/types";
import type { ActiveSession } from "./types";

export interface UseSessionReturn {
  activeSession: ActiveSession | null;
  resumeInfo: StatusResponse | null;
  setActiveSession: (s: ActiveSession | null) => void;
  handleResume: () => Promise<void>;
  handleNewSession: () => void;
  dismissResume: () => void;
}

interface SessionGraph {
  ok: boolean;
  nodes: NodeStatus[];
  title: string;
  status: string;
}

export function useSession(): UseSessionReturn {
  const [activeSession, setActiveSessionRaw] = useState<ActiveSession | null>(null);
  const [resumeInfo, setResumeInfo] = useState<StatusResponse | null>(null);
  const store = useGraphStore();

  // 启动时检查是否有可恢复的任务
  useEffect(() => {
    fetchJSON<StatusResponse>("/api/status")
      .then((data) => { if (data.canResume) setResumeInfo(data); })
      .catch(() => {});
  }, []);

  // 切换 session 时，加载该 session 的历史图状态到 store
  const setActiveSession = async (session: ActiveSession | null) => {
    setActiveSessionRaw(session);
    store.reset();

    if (!session) return;

    try {
      const data = await fetchJSON<SessionGraph>(
        `/api/projects/${session.projectId}/sessions/${session.sessionId}/graph`
      );
      if (!data.ok || !data.nodes.length) return;

      // 把历史节点逐一注入 store，让 Canvas 渲染出来
      for (const node of data.nodes) {
        applySSEEvent({ type: "node_update", payload: node }, store);
      }

      // 如果任务已完成，更新 runStatus
      if (data.status === "done") store.setRunStatus("done");
      else if (data.status === "failed") store.setRunStatus("failed");
    } catch {
      // 加载失败不阻塞，画板保持空白
    }
  };

  const handleResume = async () => {
    setResumeInfo(null);
    await fetchJSON("/api/resume", { method: "POST" }).catch(() => {});
  };

  const handleNewSession = () => {
    setActiveSessionRaw(null);
    store.reset();
  };

  const dismissResume = () => setResumeInfo(null);

  return {
    activeSession,
    resumeInfo,
    setActiveSession,
    handleResume,
    handleNewSession,
    dismissResume,
  };
}
