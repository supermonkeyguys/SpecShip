/**
 * Chat.tsx — 右侧面板（白底主题）
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { useExecutionStore } from "../../domains/execution/store";
import type { ChatMessage, SessionExecutionState } from "../../domains/execution/types";
import type { ActiveSession } from "../session/types";
import { ClarificationCard } from "./ClarificationCard";
import { createChatRunController, type ClarificationPending } from "../../domains/execution/runController";
import { LoadingState } from "../../shared/ui/LoadingState";

type Tab = "chat" | "log";

interface Props {
  sessionId?: string;
  onRunStarted?: (session: ActiveSession) => Promise<void> | void;
  onResumeRequested?: () => Promise<void> | void;
}

export function Chat({ sessionId, onRunStarted, onResumeRequested }: Props) {
  const [tab, setTab] = useState<Tab>("chat");

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => setTab(value as Tab)}
      className="h-full bg-white border-l border-gray-200"
    >
      <TabsList aria-label="Chat views" className="w-full border-b border-gray-200">
        {([
          { key: "chat", label: "Chat" },
          { key: "log", label: "Log" },
        ] as const).map((t) => (
          <TabsTrigger key={t.key} value={t.key} className="hover:text-gray-600">
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="chat" className="mt-0 flex-1 overflow-hidden">
        <ChatPanel
          key={sessionId ?? "draft"}
          sessionId={sessionId}
          onRunStarted={onRunStarted}
          onResumeRequested={onResumeRequested}
        />
      </TabsContent>
      <TabsContent value="log" className="mt-0 flex-1 overflow-hidden">
        <LogPanel />
      </TabsContent>
    </Tabs>
  );
}

function useActiveExecution(): SessionExecutionState | null {
  return useExecutionStore((state) => {
    if (!state.activeSessionId) return null;
    return state.sessions[state.activeSessionId] ?? null;
  });
}

function LogPanel() {
  const execution = useActiveExecution();
  const logs = execution?.logs ?? EMPTY_LOGS;
  const nodes = execution?.nodes ?? EMPTY_NODES;
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs, nodes]);

  const nodeList = useMemo(() => Object.values(nodes), [nodes]);

  return (
    <div className="flex-1 overflow-y-auto p-3 font-mono text-xs space-y-2">
      {nodeList.map((n) => (
        <div key={n.id} className="space-y-0.5">
          <div className={`flex items-center gap-2 ${statusColor(n.status)}`}>
            <span className="font-semibold">[{n.status.toUpperCase()}]</span>
            <span className="text-gray-700">{n.title}</span>
            {n.durationMs && (
              <span className="text-gray-400 ml-auto">{(n.durationMs / 1000).toFixed(1)}s</span>
            )}
          </div>
          {n.verifications.map((v, i) => (
            <div key={i} className={`pl-4 ${v.passed ? "text-green-600" : "text-red-500"}`}>
              {v.passed ? "✓" : "✗"} [{v.type}] {v.summary}
            </div>
          ))}
          {n.filesWritten.map((f, i) => (
            <div key={i} className="pl-4 text-gray-400">→ {f}</div>
          ))}
          {(n.toolCalls ?? []).map((t, i) => (
            <details key={`${n.id}-tool-${i}`} className="pl-4 text-gray-500">
              <summary className="cursor-pointer select-none">
                {t.success ? "🛠" : "⚠"} {t.tool} {t.success ? "ok" : "failed"}
              </summary>
              <div className="mt-1 space-y-1 text-[11px] text-gray-500">
                <div className="break-all">input: {JSON.stringify(t.input)}</div>
                <div className="break-all">output: {t.output}</div>
              </div>
            </details>
          ))}
          {n.error && (
            <div className="pl-4 text-red-500 break-all">{n.error}</div>
          )}
        </div>
      ))}
      {logs.map((log, i) => (
        <div key={i} className="text-gray-400">{log}</div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

type Message = ChatMessage;
const EMPTY_NODES: SessionExecutionState["nodes"] = {};
const EMPTY_LOGS: string[] = [];

function ChatPanel({
  sessionId,
  onRunStarted,
  onResumeRequested,
}: {
  sessionId?: string;
  onRunStarted?: (session: ActiveSession) => Promise<void> | void;
  onResumeRequested?: () => Promise<void> | void;
}) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingSpec, setPendingSpec] = useState<ClarificationPending | null>(null);

  // messages are stored in the execution store, keyed by sessionId
  const storeMessages = useExecutionStore((state) =>
    sessionId ? (state.sessions[sessionId]?.chatMessages ?? null) : null
  );
  const appendChatMessage = useExecutionStore((state) => state.appendChatMessage);
  const setChatMessages = useExecutionStore((state) => state.setChatMessages);

  // fallback for when session not yet in store (e.g. new session before first run)
  const [localMessages, setLocalMessages] = useState<Message[]>(() => [
    { role: "system", text: "Hi! Tell me what to build, or ask me to retry a failed node." },
  ]);

  const messages = storeMessages ?? localMessages;
  const setMessages = useMemo(() => {
    if (!sessionId) return setLocalMessages;
    return (updater: Message[] | ((prev: Message[]) => Message[])) => {
      const next = typeof updater === "function" ? updater(messages) : updater;
      setChatMessages(sessionId, next);
    };
  }, [sessionId, messages, setChatMessages]);

  const pushMessage = useMemo(() => {
    if (!sessionId) {
      return (msg: Message) => setLocalMessages((prev) => [...prev, msg]);
    }
    return (msg: Message) => appendChatMessage(sessionId, msg);
  }, [sessionId, appendChatMessage]);


  const execution = useActiveExecution();
  const nodes = execution?.nodes ?? EMPTY_NODES;
  const summary = execution?.summary;
  const runStatus = execution?.runStatus ?? "idle";
  const bottomRef = useRef<HTMLDivElement>(null);

  const activeSessionId = useExecutionStore((state) => state.activeSessionId);
  const activeSessionProjectId = useExecutionStore((state) =>
    state.activeSessionId ? state.sessions[state.activeSessionId]?.projectId ?? null : null
  );
  const activeSessionTitle = useExecutionStore((state) =>
    state.activeSessionId ? state.sessions[state.activeSessionId]?.title ?? "" : ""
  );

  const activeSession = useMemo<ActiveSession | null>(() => {
    if (!activeSessionId || !activeSessionProjectId) return null;
    return {
      projectId: activeSessionProjectId,
      sessionId: activeSessionId,
      spec: activeSessionTitle,
    };
  }, [activeSessionId, activeSessionProjectId, activeSessionTitle]);

  // Wrap onRunStarted: migrate current chat messages to the new session before switching,
  // so the chat history (including clarification state) is visible after the session swap.
  const wrappedOnRunStarted = useMemo(() => {
    if (!onRunStarted) return undefined;
    return async (session: ActiveSession) => {
      const currentMessages = messages;
      if (currentMessages.length > 0) {
        // Mark any pending clarification cards as answered so they don't re-render as interactive
        const migratedMessages = currentMessages.map((m): Message =>
          m.role === "clarification" && !m.answered ? { ...m, answered: true } : m
        );
        setChatMessages(session.sessionId, migratedMessages);
      }
      await onRunStarted(session);
    };
  }, [onRunStarted, messages, setChatMessages]);

  const controller = useMemo(
    () => createChatRunController({ onRunStarted: wrappedOnRunStarted, onResumeRequested }),
    [wrappedOnRunStarted, onResumeRequested]
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleClarificationConfirm = async (answers: Record<string, string>) => {
    if (!pendingSpec) return;

    setMessages((m) =>
      m.map((msg): Message =>
        msg.role === "clarification" && !msg.answered ? { ...msg, answered: true, answers } : msg
      )
    );
    setPendingSpec(null);

    setLoading(true);
    try {
      const result = await controller.confirmClarification(pendingSpec, answers);
      if (!result.ok) {
        pushMessage({ role: "system", text: `Failed: ${result.error}` });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleClarificationSkip = async () => {
    if (!pendingSpec) return;

    setMessages((m) =>
      m.map((msg): Message =>
        msg.role === "clarification" && !msg.answered ? { ...msg, answered: true } : msg
      )
    );
    setPendingSpec(null);

    setLoading(true);
    try {
      const result = await controller.skipClarification(pendingSpec);
      if (!result.ok) {
        pushMessage({ role: "system", text: `Failed: ${result.error}` });
      }
    } finally {
      setLoading(false);
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput("");
    pushMessage({ role: "user", text });
    setLoading(true);

    try {
      const currentNodes = Object.values(nodes).map((n) => ({ id: n.id, title: n.title, status: n.status }));
      const currentSpec = summary?.title ?? execution?.title ?? undefined;

      const result = await controller.send({ message: text, currentNodes, currentSpec, activeSession });

      if (result.type === "clarification") {
        pushMessage({ role: "ai", text: result.text });
        pushMessage({ role: "clarification", questions: result.questions, answered: false });
        setPendingSpec(result.pending);
        return;
      }

      if (result.type === "reply") {
        pushMessage({ role: "ai", text: result.text });
        return;
      }

      pushMessage({ role: "system", text: result.text });
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="flex-1 flex flex-col overflow-hidden" aria-label="Chat messages and composer">
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {messages.map((m, i) => {
          if (m.role === "clarification") {
            if (m.answered) {
              return (
                <div key={i} className="rounded-2xl border border-green-300 bg-green-50 overflow-hidden text-xs">
                  <div className="px-4 py-2.5 flex items-center gap-2 font-semibold text-green-700 bg-green-100 border-b border-green-200">
                    <span>✅</span>
                    <span>Confirmed. Starting execution.</span>
                  </div>
                  {m.answers && (
                    <div className="px-4 py-2.5 flex flex-col gap-1.5">
                      {m.questions.map((q) => (
                        <div key={q.id} className="flex gap-2 text-[11px]">
                          <span className="text-gray-500 shrink-0">
                            {q.text.slice(0, 20)}{q.text.length > 20 ? "…" : ""}
                          </span>
                          <span className="text-blue-600 font-semibold">→ {m.answers![q.id]}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            }
            return (
              <ClarificationCard
                key={i}
                questions={m.questions}
                onConfirm={handleClarificationConfirm}
                onSkip={handleClarificationSkip}
              />
            );
          }
          return (
            <div
              key={i}
              className={`text-xs px-3 py-2 rounded-lg font-mono ${
                m.role === "user"
                  ? "bg-blue-600 text-white ml-4"
                  : m.role === "ai"
                  ? "bg-gray-100 text-gray-800 border border-gray-200"
                  : "text-gray-400 text-center"
              }`}
            >
              {m.role === "user" ? "> " : ""}{m.text}
            </div>
          );
        })}
        {loading && <LoadingState label="Thinking" className="px-3 py-2 rounded-lg bg-gray-100 border border-gray-200" />}
        <div ref={bottomRef} />
      </div>

      {runStatus === "running" && (
        <div className="px-3 py-1.5 text-xs text-amber-600 border-t border-gray-100 font-mono bg-amber-50" role="status" aria-live="polite">
          ● Running
        </div>
      )}

      <div className="border-t border-gray-200 p-3 flex gap-2">
        <Input
          aria-label="Message input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Build something, retry a node..."
          disabled={loading}
          className="h-auto flex-1 rounded-lg bg-gray-50 py-2 text-xs font-mono shadow-none"
        />
        <Button
          type="button"
          onClick={send}
          disabled={loading}
          className="h-auto rounded-lg px-3 py-2 text-xs font-medium"
        >
          Send
        </Button>
      </div>
    </section>
  );
}

function statusColor(status: string): string {
  const map: Record<string, string> = {
    running:   "text-amber-600",
    done:      "text-green-600",
    failed:    "text-red-500",
    verifying: "text-purple-600",
    blocked:   "text-gray-400",
  };
  return map[status] ?? "text-gray-500";
}
