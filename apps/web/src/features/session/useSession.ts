/**
 * useSession.ts — Session 状态管理
 *
 * 切换 session 时自动从服务端加载历史图状态到 session-aware execution store，
 * 让 Canvas 和 Log 能展示对应 session 的历史内容。
 */

import { useEffect, useRef, useState } from "react";
import { useExecutionStore } from "../../domains/execution/store";
import type { GraphRunStatus } from "../../domains/execution/types";
import { fetchJSON } from "../../utils/fetchJSON";
import type { StatusResponse, NodeStatus } from "../../types";
import type { ActiveSession } from "./types";
import { useWorkspaceStore } from "../../domains/workspace/store";

export interface UseSessionReturn {
  activeSession: ActiveSession | null;
  resumeInfo: StatusResponse | null;
  setActiveSession: (s: ActiveSession | null) => Promise<void>;
  activateStartedSession: (s: ActiveSession) => Promise<void>;
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

interface ActivateSessionOptions {
  optimisticRunStatus?: GraphRunStatus;
}

export function useSession(): UseSessionReturn {
  const [activeSession, setActiveSessionRaw] = useState<ActiveSession | null>(null);
  const [resumeInfo, setResumeInfo] = useState<StatusResponse | null>(null);
  const sessionRequestIdRef = useRef(0);
  const setWorkspaceActiveSession = useWorkspaceStore((state) => state.setActiveSession);
  const setWorkspaceResumeInfo = useWorkspaceStore((state) => state.setResumeInfo);

  // 启动时检查是否有可恢复的任务
  useEffect(() => {
    fetchJSON<StatusResponse>("/api/status")
      .then((data) => {
        if (data.canResume) {
          setResumeInfo(data);
          setWorkspaceResumeInfo(data);
        }
      })
      .catch(() => {});
  }, [setWorkspaceResumeInfo]);

  async function loadSessionIntoStore(
    session: ActiveSession | null,
    options?: ActivateSessionOptions
  ): Promise<void> {
    const requestId = ++sessionRequestIdRef.current;
    const executionStore = useExecutionStore.getState();

    setActiveSessionRaw(session);
    setWorkspaceActiveSession(session);
    executionStore.activateSession(session);

    if (!session) return;

    if (options?.optimisticRunStatus) {
      executionStore.setSessionRunStatus(session.sessionId, options.optimisticRunStatus);
    }

    try {
      const data = await fetchJSON<SessionGraph>(
        `/api/projects/${session.projectId}/sessions/${session.sessionId}/graph`
      );

      if (sessionRequestIdRef.current !== requestId) return;

      if (data.ok) {
        executionStore.replaceSessionSnapshot(session, data, {
          optimisticRunStatus: options?.optimisticRunStatus,
        });
      } else if (!options?.optimisticRunStatus) {
        executionStore.setSessionRunStatus(session.sessionId, "idle");
      }
    } catch {
      if (sessionRequestIdRef.current !== requestId) return;
      if (!options?.optimisticRunStatus) {
        executionStore.setSessionRunStatus(session.sessionId, "idle");
      }
      // 加载失败不阻塞，画板保持空白/已有缓存
    }
  }

  const setActiveSession = async (session: ActiveSession | null) => {
    await loadSessionIntoStore(session);
  };

  const activateStartedSession = async (session: ActiveSession) => {
    const executionStore = useExecutionStore.getState();
    setResumeInfo(null);
    setWorkspaceResumeInfo(null);
    executionStore.setLiveSession(session);
    executionStore.setSessionRunStatus(session.sessionId, "running");
    await loadSessionIntoStore(session, { optimisticRunStatus: "running" });
  };

  const handleResume = async () => {
    const executionStore = useExecutionStore.getState();
    setResumeInfo(null);
    setWorkspaceResumeInfo(null);

    const resumeTarget = activeSession ?? (resumeInfo?.projectId && resumeInfo?.sessionId
      ? {
          projectId: resumeInfo.projectId,
          sessionId: resumeInfo.sessionId,
          spec: resumeInfo.spec ?? "Resumed session",
        }
      : null);

    if (resumeTarget) {
      executionStore.setLiveSession(resumeTarget);
      executionStore.setSessionRunStatus(resumeTarget.sessionId, "running");
      if (!activeSession) {
        setActiveSessionRaw(resumeTarget);
        setWorkspaceActiveSession(resumeTarget);
        executionStore.activateSession(resumeTarget);
      }
    }

    await fetchJSON("/api/resume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: resumeTarget?.projectId,
        sessionId: resumeTarget?.sessionId,
      }),
    }).catch(() => {
      if (resumeTarget) {
        executionStore.setSessionRunStatus(resumeTarget.sessionId, "failed");
      }
    });
  };

  const handleNewSession = () => {
    sessionRequestIdRef.current += 1;
    setActiveSessionRaw(null);
    setWorkspaceActiveSession(null);
    useExecutionStore.getState().activateSession(null);
  };

  const dismissResume = () => {
    setResumeInfo(null);
    setWorkspaceResumeInfo(null);
  };

  return {
    activeSession,
    resumeInfo,
    setActiveSession,
    activateStartedSession,
    handleResume,
    handleNewSession,
    dismissResume,
  };
}
