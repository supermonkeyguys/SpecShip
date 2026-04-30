import { create } from "zustand";
import type { SSEEvent } from "../../types";
import type {
  ChatMessage,
  GraphRunStatus,
  SessionExecutionState,
  SessionGraphSnapshot,
  SessionRef,
  StreamStatus,
} from "./types";

const INITIAL_CHAT_MESSAGES: ChatMessage[] = [
  { role: "system", text: "Hi! Tell me what to build, or ask me to retry a failed node." },
];

function createEmptySession(ref: SessionRef): SessionExecutionState {
  return {
    projectId: ref.projectId,
    sessionId: ref.sessionId,
    title: ref.spec ?? "",
    nodes: {},
    logs: [],
    summary: null,
    runStatus: "idle",
    source: "snapshot",
    lastUpdatedAt: null,
    chatMessages: [...INITIAL_CHAT_MESSAGES],
  };
}

function toNodeMap(nodes: SessionGraphSnapshot["nodes"]): Record<string, SessionExecutionState["nodes"][string]> {
  return Object.fromEntries(nodes.map((node) => [node.id, node]));
}

function resolveRunStatus(snapshotStatus: string, optimistic?: GraphRunStatus): GraphRunStatus {
  if (snapshotStatus === "done") return "done";
  if (snapshotStatus === "failed") return "failed";
  if (snapshotStatus === "building" || snapshotStatus === "running" || snapshotStatus === "paused") {
    return "running";
  }
  return optimistic ?? "idle";
}

export interface ExecutionStoreState {
  sessions: Record<string, SessionExecutionState>;
  activeSessionId: string | null;
  liveSessionId: string | null;
  streamStatus: StreamStatus;
  activateSession: (session: SessionRef | null) => void;
  setLiveSession: (session: SessionRef | null) => void;
  setStreamStatus: (status: StreamStatus) => void;
  setSessionRunStatus: (sessionId: string, status: GraphRunStatus) => void;
  appendSessionLog: (sessionId: string, message: string) => void;
  replaceSessionSnapshot: (
    session: SessionRef,
    snapshot: SessionGraphSnapshot,
    options?: { optimisticRunStatus?: GraphRunStatus }
  ) => void;
  applyRealtimeEvent: (event: SSEEvent, targetSessionId?: string) => void;
  appendChatMessage: (sessionId: string, message: ChatMessage) => void;
  setChatMessages: (sessionId: string, messages: ChatMessage[]) => void;
}

export const useExecutionStore = create<ExecutionStoreState>((set) => ({
  sessions: {},
  activeSessionId: null,
  liveSessionId: null,
  streamStatus: "disconnected",

  activateSession: (session) =>
    set((state) => {
      if (!session) {
        return { activeSessionId: null };
      }

      return {
        activeSessionId: session.sessionId,
        sessions: state.sessions[session.sessionId]
          ? state.sessions
          : {
              ...state.sessions,
              [session.sessionId]: createEmptySession(session),
            },
      };
    }),

  setLiveSession: (session) =>
    set((state) => {
      if (!session) return { liveSessionId: null };
      return {
        liveSessionId: session.sessionId,
        sessions: state.sessions[session.sessionId]
          ? state.sessions
          : {
              ...state.sessions,
              [session.sessionId]: createEmptySession(session),
            },
      };
    }),

  setStreamStatus: (status) => set({ streamStatus: status }),

  setSessionRunStatus: (sessionId, status) =>
    set((state) => {
      const existing = state.sessions[sessionId] ?? createEmptySession({
        projectId: "",
        sessionId,
      });
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...existing,
            runStatus: status,
            lastUpdatedAt: Date.now(),
          },
        },
      };
    }),

  appendSessionLog: (sessionId, message) =>
    set((state) => {
      const existing = state.sessions[sessionId] ?? createEmptySession({
        projectId: "",
        sessionId,
      });
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...existing,
            logs: [...existing.logs, message],
            lastUpdatedAt: Date.now(),
          },
        },
      };
    }),

  replaceSessionSnapshot: (session, snapshot, options) =>
    set((state) => {
      const existing = state.sessions[session.sessionId] ?? createEmptySession(session);
      return {
        sessions: {
          ...state.sessions,
          [session.sessionId]: {
            ...existing,
            projectId: session.projectId,
            sessionId: session.sessionId,
            title: snapshot.title || existing.title || session.spec || "",
            nodes: toNodeMap(snapshot.nodes ?? []),
            logs: existing.logs,
            summary: existing.summary,
            runStatus: resolveRunStatus(snapshot.status, options?.optimisticRunStatus),
            source: "snapshot",
            lastUpdatedAt: Date.now(),
            chatMessages: existing.chatMessages.length > 0 ? existing.chatMessages : [...INITIAL_CHAT_MESSAGES],
          },
        },
      };
    }),

  applyRealtimeEvent: (event, targetSessionId) =>
    set((state) => {
      const resolvedSessionId = targetSessionId ?? state.liveSessionId ?? state.activeSessionId;
      if (!resolvedSessionId) return state;

      // 优先从 SSE 事件里取 projectId，其次从已有 session 取，最后才留空
      const existingProjectId = state.sessions[resolvedSessionId]?.projectId;
      const resolvedProjectId = (event as { projectId?: string }).projectId ?? existingProjectId ?? "";
      const existing = state.sessions[resolvedSessionId] ?? createEmptySession({
        projectId: resolvedProjectId,
        sessionId: resolvedSessionId,
      });
      // 如果已有 session 的 projectId 是空的但现在有了，补上
      const patchedExisting = !existingProjectId && resolvedProjectId
        ? { ...existing, projectId: resolvedProjectId }
        : existing;

      switch (event.type) {
        case "node_update": {
          const node = event.payload as SessionExecutionState["nodes"][string];
          return {
            sessions: {
              ...state.sessions,
              [resolvedSessionId]: {
                ...patchedExisting,
                nodes: { ...patchedExisting.nodes, [node.id]: node },
                runStatus:
                  patchedExisting.runStatus === "done" || patchedExisting.runStatus === "failed"
                    ? patchedExisting.runStatus
                    : "running",
                source: "realtime",
                lastUpdatedAt: Date.now(),
              },
            },
          };
        }
        case "graph_done":
        case "graph_failed": {
          return {
            liveSessionId: state.liveSessionId === resolvedSessionId ? null : state.liveSessionId,
            sessions: {
              ...state.sessions,
              [resolvedSessionId]: {
                ...patchedExisting,
                summary: event.payload as SessionExecutionState["summary"],
                runStatus: event.type === "graph_done" ? "done" : "failed",
                source: "realtime",
                lastUpdatedAt: Date.now(),
              },
            },
          };
        }
        case "log": {
          return {
            sessions: {
              ...state.sessions,
              [resolvedSessionId]: {
                ...patchedExisting,
                logs: [...patchedExisting.logs, event.payload as string],
                source: "realtime",
                lastUpdatedAt: Date.now(),
              },
            },
          };
        }
        default:
          return state;
      }
    }),
  appendChatMessage: (sessionId, message) =>
    set((state) => {
      const existing = state.sessions[sessionId] ?? createEmptySession({ projectId: "", sessionId });
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...existing,
            chatMessages: [...existing.chatMessages, message],
          },
        },
      };
    }),

  setChatMessages: (sessionId, messages) =>
    set((state) => {
      const existing = state.sessions[sessionId] ?? createEmptySession({ projectId: "", sessionId });
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...existing,
            chatMessages: messages,
          },
        },
      };
    }),
}));

export function getExecutionStore() {
  return useExecutionStore.getState();
}
