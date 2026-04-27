/**
 * Chat.tsx — 右侧面板（白底主题）
 */

import { useEffect, useRef, useState } from "react";
import { useGraphStore } from "../../store/graph";
import type { ChatResponse } from "../../../../server/types";
import { fetchJSON } from "../../utils/fetchJSON";

type Tab = "chat" | "log";

interface Props {
  sessionId?: string;  // 当前 session，切换时重置聊天历史
}

export function Chat({ sessionId }: Props) {
  const [tab, setTab] = useState<Tab>("chat");

  return (
    <div className="h-full bg-white border-l border-gray-200 flex flex-col">
      <div className="flex border-b border-gray-200">
        {(["chat", "log"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-xs font-medium uppercase tracking-wider transition-colors ${
              tab === t
                ? "text-blue-600 border-b-2 border-blue-500"
                : "text-gray-400 hover:text-gray-600"
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "log" ? <LogPanel /> : <ChatPanel sessionId={sessionId} />}
    </div>
  );
}

function LogPanel() {
  const logs = useGraphStore((s) => s.logs);
  const nodes = useGraphStore((s) => s.nodes);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs, nodes]);

  return (
    <div className="flex-1 overflow-y-auto p-3 font-mono text-xs space-y-2">
      {Object.values(nodes).map((n) => (
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

type Message = { role: "user" | "ai" | "system"; text: string };
const INITIAL_MESSAGES: Message[] = [{ role: "system", text: "Hi! Tell me what to build, or ask me to retry a failed node." }];

function ChatPanel({ sessionId }: { sessionId?: string }) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingSpec, setPendingSpec] = useState<{ spec: string; repoPath?: string } | null>(null);
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);

  // session 切换时重置聊天历史
  useEffect(() => {
    setMessages(INITIAL_MESSAGES);
    setInput("");
    setPendingSpec(null);
  }, [sessionId]);

  const nodes = useGraphStore((s) => s.nodes);
  const summary = useGraphStore((s) => s.summary);
  const runStatus = useGraphStore((s) => s.runStatus);
  const reset = useGraphStore((s) => s.reset);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const runSpec = async (spec: string, repoPath?: string) => {
    reset();
    try {
      const d = await fetchJSON<{ ok: boolean; error?: string }>("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spec, repoPath }),
      });
      if (!d.ok) setMessages((m) => [...m, { role: "system", text: `Failed: ${d.error}` }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "system", text: `Failed: ${(e as Error).message}` }]);
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text }]);

    // 如果有待确认的 spec，用户的回复作为补充信息
    if (pendingSpec) {
      setPendingSpec(null);
      const isSkip = /just do it|proceed|skip|跳过|直接/i.test(text);
      const enrichedSpec = isSkip
        ? pendingSpec.spec
        : `${pendingSpec.spec}\n\nAdditional context: ${text}`;
      setMessages((m) => [...m, { role: "system", text: "Starting..." }]);
      setLoading(true);
      try { await runSpec(enrichedSpec, pendingSpec.repoPath); }
      finally { setLoading(false); }
      return;
    }

    setLoading(true);

    try {
      const currentNodes = Object.values(nodes).map((n) => ({
        id: n.id, title: n.title, status: n.status,
      }));
      const currentSpec = summary?.title ?? undefined;

      const data = await fetchJSON<ChatResponse>("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, currentNodes, currentSpec }),
      });

      if (!data.ok) {
        setMessages((m) => [...m, { role: "ai", text: data.intent.reply }]);
        return;
      }

      const { intent } = data;
      setMessages((m) => [...m, { role: "ai", text: intent.reply }]);

      if (intent.type === "retry_node") {
        try {
          const d = await fetchJSON<{ ok: boolean; error?: string }>(`/api/node/${intent.nodeId}/retry`, { method: "POST" });
          if (!d.ok) setMessages((m) => [...m, { role: "system", text: `Retry failed: ${d.error}` }]);
        } catch (e) {
          setMessages((m) => [...m, { role: "system", text: `Retry failed: ${(e as Error).message}` }]);
        }
      } else if (intent.type === "new_run") {
        try {
          const clarifyData = await fetchJSON<{ needsClarification: boolean; questions: string[] }>("/api/clarify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ spec: intent.spec }),
          });
          if (clarifyData.needsClarification && clarifyData.questions?.length) {
            const questionText = clarifyData.questions.map((q: string, i: number) => `${i + 1}. ${q}`).join("\n");
            setMessages((m) => [...m, {
              role: "ai",
              text: `Before I start, a few questions:\n${questionText}\n\nPlease reply with your answers, or type "just do it" to proceed anyway.`,
            }]);
            setPendingSpec({ spec: intent.spec, repoPath: intent.repoPath });
          } else {
            await runSpec(intent.spec, intent.repoPath);
          }
        } catch {
          // clarify 失败直接跑
          await runSpec(intent.spec, intent.repoPath);
        }
      } else if (intent.type === "resume") {
        try {
          const d = await fetchJSON<{ ok: boolean; error?: string }>("/api/resume", { method: "POST" });
          if (!d.ok) setMessages((m) => [...m, { role: "system", text: `Resume failed: ${d.error}` }]);
        } catch (e) {
          setMessages((m) => [...m, { role: "system", text: `Resume failed: ${(e as Error).message}` }]);
        }
      }
    } catch (e) {
      setMessages((m) => [...m, { role: "system", text: `Error: ${(e as Error).message}` }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {messages.map((m, i) => (
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
        ))}
        {loading && (
          <div className="text-xs px-3 py-2 rounded-lg bg-gray-100 text-gray-400 font-mono animate-pulse border border-gray-200">
            thinking...
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {runStatus === "running" && (
        <div className="px-3 py-1.5 text-xs text-amber-600 border-t border-gray-100 font-mono bg-amber-50">
          ● Running...
        </div>
      )}

      <div className="border-t border-gray-200 p-3 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Build something, retry a node..."
          disabled={loading}
          className="flex-1 bg-gray-50 text-gray-800 text-xs px-3 py-2 rounded-lg border border-gray-200 focus:outline-none focus:border-blue-400 font-mono disabled:opacity-50"
        />
        <button
          onClick={send}
          disabled={loading}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs px-3 py-2 rounded-lg transition-colors font-medium"
        >
          Send
        </button>
      </div>
    </div>
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
