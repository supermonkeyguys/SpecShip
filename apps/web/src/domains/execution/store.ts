import { create } from "zustand";
import type { SSEEvent } from "../../types";
import { sessionRefFromKey, toSessionKey, type SessionKey, type SessionRef } from "../../features/session/types";
import type {
  ChatMessage,
  GraphRunStatus,
  SessionExecutionState,
  SessionGraphSnapshot,
  StreamStatus,
} from "./types";

const INITIAL_CHAT_MESSAGES: ChatMessage[] = [
  { role: "system", text: "Hi! Tell me what to build, or ask me to retry a failed node." },
];

function createEmptySession(ref: SessionRef): SessionExecutionState {
  return {
    projectId: ref.projectId,
    sessionId: ref.sessionId,
    title: "",
    nodes: {},
    logs: [],
    summary: null,
    runStatus: "idle",
    source: "snapshot",
    lastUpdatedAt: null,
    revision: 0,
    parity: null,
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

function resolveSessionKey(session: SessionRef | SessionKey): SessionKey {
  return typeof session === "string" ? session : toSessionKey(session);
}

function resolveSessionRef(session: SessionRef | SessionKey): SessionRef {
  return typeof session === "string" ? sessionRefFromKey(session) : session;
}

export interface ExecutionStoreState {
  sessions: Record<SessionKey, SessionExecutionState>;
  liveSessionKey: SessionKey | null;
  streamStatus: StreamStatus;
  ensureSession: (session: SessionRef) => void;
  clearSession: (session: SessionRef | SessionKey) => void;
  setLiveSession: (session: SessionRef | null) => void;
  setStreamStatus: (status: StreamStatus) => void;
  setSessionRunStatus: (session: SessionRef | SessionKey, status: GraphRunStatus) => void;
  appendSessionLog: (session: SessionRef | SessionKey, message: string) => void;
  replaceSessionSnapshot: (
    session: SessionRef,
    snapshot: SessionGraphSnapshot,
    options?: { optimisticRunStatus?: GraphRunStatus }
  ) => void;
  applyRealtimeEvent: (event: SSEEvent) => void;
  appendChatMessage: (session: SessionRef | SessionKey, message: ChatMessage) => void;
  setChatMessages: (session: SessionRef | SessionKey, messages: ChatMessage[]) => void;
}

export const useExecutionStore = create<ExecutionStoreState>((set) => ({
  sessions: {},
  liveSessionKey: null,
  streamStatus: "disconnected",

  ensureSession: (session) =>
    set((state) => {
      const key = toSessionKey(session);
      if (state.sessions[key]) return state;
      return {
        sessions: {
          ...state.sessions,
          [key]: createEmptySession(session),
        },
      };
    }),

  clearSession: (session) =>
    set((state) => {
      const key = resolveSessionKey(session);
      const next = { ...state.sessions };
      delete next[key];
      return {
        sessions: next,
        liveSessionKey: state.liveSessionKey === key ? null : state.liveSessionKey,
      };
    }),

  setLiveSession: (session) =>
    set((state) => {
      if (!session) return { liveSessionKey: null };
      const key = toSessionKey(session);
      return {
        liveSessionKey: key,
        sessions: state.sessions[key]
          ? state.sessions
          : {
              ...state.sessions,
              [key]: createEmptySession(session),
            },
      };
    }),

  setStreamStatus: (status) => set({ streamStatus: status }),

  setSessionRunStatus: (session, status) =>
    set((state) => {
      const key = resolveSessionKey(session);
      const existing = state.sessions[key] ?? createEmptySession(resolveSessionRef(session));
      return {
        sessions: {
          ...state.sessions,
          [key]: {
            ...existing,
            runStatus: status,
            lastUpdatedAt: Date.now(),
          },
        },
      };
    }),

  appendSessionLog: (session, message) =>
    set((state) => {
      const key = resolveSessionKey(session);
      const existing = state.sessions[key] ?? createEmptySession(resolveSessionRef(session));
      return {
        sessions: {
          ...state.sessions,
          [key]: {
            ...existing,
            logs: [...existing.logs, message],
            lastUpdatedAt: Date.now(),
          },
        },
      };
    }),

  replaceSessionSnapshot: (session, snapshot, options) =>
    set((state) => {
      const key = toSessionKey(session);
      const existing = state.sessions[key] ?? createEmptySession(session);
      const nextRevision = typeof snapshot.revision === "number" ? snapshot.revision : existing.revision;
      return {
        sessions: {
          ...state.sessions,
          [key]: {
            ...existing,
            projectId: session.projectId,
            sessionId: session.sessionId,
            title: snapshot.title || existing.title || "",
            nodes: toNodeMap(snapshot.nodes ?? []),
            logs: existing.logs,
            summary: existing.summary,
            runStatus: resolveRunStatus(snapshot.status, options?.optimisticRunStatus),
            source: snapshot.source ?? "snapshot",
            lastUpdatedAt: Date.now(),
            revision: nextRevision,
            parity: snapshot.parity ?? null,
            chatMessages: existing.chatMessages.length > 0 ? existing.chatMessages : [...INITIAL_CHAT_MESSAGES],
          },
        },
      };
    }),

  applyRealtimeEvent: (event) =>
    set((state) => {
      const explicitKey = event.projectId && event.sessionId ? toSessionKey(event.projectId, event.sessionId) : null;
      const resolvedKey = explicitKey ?? state.liveSessionKey;
      if (!resolvedKey) return state;

      const resolvedRef = explicitKey && event.projectId && event.sessionId
        ? { projectId: event.projectId, sessionId: event.sessionId }
        : sessionRefFromKey(resolvedKey);
      const existing = state.sessions[resolvedKey] ?? createEmptySession(resolvedRef);

      switch (event.type) {
        case "node_update": {
          const node = event.payload as SessionExecutionState["nodes"][string];
          return {
            sessions: {
              ...state.sessions,
              [resolvedKey]: {
                ...existing,
                nodes: { ...existing.nodes, [node.id]: node },
                runStatus:
                  existing.runStatus === "done" || existing.runStatus === "failed"
                    ? existing.runStatus
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
            liveSessionKey: state.liveSessionKey === resolvedKey ? null : state.liveSessionKey,
            sessions: {
              ...state.sessions,
              [resolvedKey]: {
                ...existing,
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
              [resolvedKey]: {
                ...existing,
                logs: [...existing.logs, event.payload as string],
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

  appendChatMessage: (session, message) =>
    set((state) => {
      const key = resolveSessionKey(session);
      const existing = state.sessions[key] ?? createEmptySession(resolveSessionRef(session));
      return {
        sessions: {
          ...state.sessions,
          [key]: {
            ...existing,
            chatMessages: [...existing.chatMessages, message],
          },
        },
      };
    }),

  setChatMessages: (session, messages) =>
    set((state) => {
      const key = resolveSessionKey(session);
      const existing = state.sessions[key] ?? createEmptySession(resolveSessionRef(session));
      return {
        sessions: {
          ...state.sessions,
          [key]: {
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
