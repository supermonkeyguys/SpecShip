import { useEffect, useMemo, useRef, useState } from "react";
import { selectExecutionByRef } from "../../../domains/execution/selectors";
import { createChatRunController, type PRDPending } from "../../../domains/execution/runController";
import { useExecutionStore } from "../../../domains/execution/store";
import { retrySession } from "../../../shared/api/nodeClient";
import type { ActiveSession, SessionRef } from "../../session/types";
import { useExecutionForSession } from "../hooks/useExecutionForSession";
import type { ChatProps, Message } from "../types";
import { ChatPanelView } from "../views/ChatPanelView";

const INITIAL_MESSAGES: Message[] = [
  { role: "system", text: "Hi! Tell me what to build, or ask me to retry a failed node." },
];

interface Props extends ChatProps {
  sessionRef: SessionRef;
}

export function ChatPanelContainer({ sessionRef, onRunStarted, onResumeRequested }: Props) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingPRD, setPendingPRD] = useState<PRDPending | null>(null);
  const [retrying, setRetrying] = useState(false);

  const execution = useExecutionForSession(sessionRef);
  const storeMessages = useExecutionStore((state) =>
    selectExecutionByRef(state, sessionRef)?.chatMessages ?? INITIAL_MESSAGES
  );
  const appendChatMessage = useExecutionStore((state) => state.appendChatMessage);
  const setChatMessages = useExecutionStore((state) => state.setChatMessages);

  const messages = storeMessages;
  const nodes = execution?.nodes ?? {};
  const summary = execution?.summary;
  const runStatus = execution?.runStatus ?? "idle";
  const bottomRef = useRef<HTMLDivElement>(null);
  const activeSession = sessionRef;

  const wrappedOnRunStarted = useMemo(() => {
    if (!onRunStarted) return undefined;
    return async (session: ActiveSession) => {
      const migratedMessages = messages.map((message): Message =>
        message.role === "prd" && !message.confirmed ? { ...message, confirmed: true } : message
      );
      setChatMessages(session, migratedMessages);
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

  const handlePRDConfirm = async (prd: string) => {
    if (!pendingPRD) return;

    setChatMessages(
      sessionRef,
      messages.map((message): Message =>
        message.role === "prd" && !message.confirmed ? { ...message, confirmed: true, prd } : message
      )
    );
    setPendingPRD(null);

    setLoading(true);
    try {
      const result = await controller.confirmPRD(prd, pendingPRD);
      if (!result.ok) {
        appendChatMessage(sessionRef, { role: "system", text: `Failed: ${result.error}` });
      }
    } finally {
      setLoading(false);
    }
  };

  const handlePRDDiscard = async () => {
    if (!pendingPRD) return;

    setChatMessages(
      sessionRef,
      messages.map((message): Message =>
        message.role === "prd" && !message.confirmed ? { ...message, confirmed: true } : message
      )
    );
    const pending = pendingPRD;
    setPendingPRD(null);

    setLoading(true);
    try {
      const result = await controller.discardPRD(pending);
      if (!result.ok) {
        appendChatMessage(sessionRef, { role: "system", text: `Failed: ${result.error}` });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRetrySession = async () => {
    if (!activeSession || retrying) return;
    setRetrying(true);
    try {
      const result = await retrySession(activeSession);
      if (result.ok && result.projectId && result.sessionId) {
        await wrappedOnRunStarted?.({ projectId: result.projectId, sessionId: result.sessionId });
      } else {
        appendChatMessage(sessionRef, { role: "system", text: `Retry failed: ${result.error ?? "unknown"}` });
      }
    } catch (error) {
      appendChatMessage(sessionRef, { role: "system", text: `Retry failed: ${(error as Error).message}` });
    } finally {
      setRetrying(false);
    }
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput("");
    appendChatMessage(sessionRef, { role: "user", text });
    setLoading(true);

    try {
      const currentNodes = Object.values(nodes).map((node) => ({
        id: node.id,
        title: node.title,
        status: node.status,
      }));
      const currentSpec = summary?.title ?? execution?.title ?? undefined;

      const result = await controller.send({
        message: text,
        currentNodes,
        currentSpec,
        activeSession,
      });

      if (result.type === "prd") {
        appendChatMessage(sessionRef, { role: "ai", text: result.text });
        appendChatMessage(sessionRef, { role: "prd", prd: result.prd, confirmed: false });
        setPendingPRD(result.pending);
        return;
      }

      if (result.type === "reply") {
        appendChatMessage(sessionRef, { role: "ai", text: result.text });
        return;
      }

      appendChatMessage(sessionRef, { role: "system", text: result.text });
    } finally {
      setLoading(false);
    }
  };

  return (
    <ChatPanelView
      messages={messages}
      loading={loading}
      input={input}
      runStatus={runStatus}
      retrying={retrying}
      canRetry={Boolean(activeSession)}
      bottomRef={bottomRef}
      onInputChange={setInput}
      onSend={handleSend}
      onRetrySession={handleRetrySession}
      onPRDConfirm={handlePRDConfirm}
      onPRDDiscard={handlePRDDiscard}
    />
  );
}
