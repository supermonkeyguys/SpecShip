/**
 * useSession.ts — Session 状态管理
 *
 * 切换 session 时自动从服务端加载历史图状态到 session-aware execution store，
 * 让 Canvas 和 Log 能展示对应 session 的历史内容。
 */

import { useEffect, useRef } from "react";
import { useExecutionStore } from "../../domains/execution/store";
import type { GraphRunStatus } from "../../domains/execution/types";
import { fetchJSON } from "../../utils/fetchJSON";
import type { StatusResponse, NodeStatus } from "../../types";
import type { ActiveSession, SessionRef } from "./types";
import { useWorkspaceStore } from "../../domains/workspace/store";
import { selectResumeTargetRef } from "../../domains/session/selectors";

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

function asSessionRef(session: ActiveSession | SessionRef | null): SessionRef | null {
  return session ? { projectId: session.projectId, sessionId: session.sessionId } : null;
}

export function useSession(): UseSessionReturn {
  const sessionRequestIdRef = useRef(0);
  const activeSession = useWorkspaceStore((state) => state.activeSession);
  const resumeInfo = useWorkspaceStore((state) => state.resumeInfo);
  const setWorkspaceActiveSession = useWorkspaceStore((state) => state.setActiveSession);
  const setWorkspaceResumeInfo = useWorkspaceStore((state) => state.setResumeInfo);
  const resetSessionScopedView = useWorkspaceStore((state) => state.resetSessionScopedView);
  const resetCreationFlow = useWorkspaceStore((state) => state.resetCreationFlow);

  // 启动时检查是否有可恢复的任务
  useEffect(() => {
    fetchJSON<StatusResponse>("/api/status")
      .then((data) => {
        if (data.canResume) {
          setWorkspaceResumeInfo(data);
        }
      })
      .catch(() => {});
  }, [setWorkspaceResumeInfo]);

  async function loadSessionIntoStore(
    session: SessionRef | null,
    options?: ActivateSessionOptions
  ): Promise<void> {
    const requestId = ++sessionRequestIdRef.current;
    const executionStore = useExecutionStore.getState();

    setWorkspaceActiveSession(session);
    resetSessionScopedView();

    if (!session) return;

    executionStore.ensureSession(session);

    if (options?.optimisticRunStatus) {
      executionStore.setSessionRunStatus(session, options.optimisticRunStatus);
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
        executionStore.setSessionRunStatus(session, "idle");
      }
    } catch {
      if (sessionRequestIdRef.current != requestId) return;
      if (!options?.optimisticRunStatus) {
        executionStore.setSessionRunStatus(session, "idle");
      }
      // 加载失败不阻塞，画板保持空白/已有缓存
    }
  }

  const setActiveSession = async (session: ActiveSession | null) => {
    await loadSessionIntoStore(asSessionRef(session));
  };

  const activateStartedSession = async (session: ActiveSession) => {
    const executionStore = useExecutionStore.getState();
    const ref = asSessionRef(session)!;
    setWorkspaceResumeInfo(null);
    executionStore.setLiveSession(ref);
    executionStore.setSessionRunStatus(ref, "running");
    await loadSessionIntoStore(ref, { optimisticRunStatus: "running" });
  };

  const handleResume = async () => {
    const executionStore = useExecutionStore.getState();
    const fallbackTarget = selectResumeTargetRef(useWorkspaceStore.getState());
    const resumeTarget = activeSession ?? fallbackTarget;
    setWorkspaceResumeInfo(null);

    if (resumeTarget) {
      executionStore.ensureSession(resumeTarget);
      executionStore.setLiveSession(resumeTarget);
      executionStore.setSessionRunStatus(resumeTarget, "running");
      await loadSessionIntoStore(resumeTarget, { optimisticRunStatus: "running" });
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
        executionStore.setSessionRunStatus(resumeTarget, "failed");
      }
    });
  };

  const handleNewSession = () => {
    sessionRequestIdRef.current += 1;
    setWorkspaceActiveSession(null);
    resetSessionScopedView();
    resetCreationFlow();
  };

  const dismissResume = () => {
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
