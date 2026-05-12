import { useCallback } from "react";
import { useExecutionStore } from "../../domains/execution/store";
import { useWorkspaceStore } from "../../domains/workspace/store";
import { selectCreationFlow } from "../../domains/workspace/selectors";
import { clarifySpec } from "../../shared/api/clarifyClient";
import { generatePRD } from "../../shared/api/prdClient";
import { runSpec } from "../../shared/api/runClient";
import type { ActiveSession } from "../session/types";
import type { Message } from "../chat/types";
import type { PendingClarification } from "../../domains/workspace/types";

interface Args {
  onRunStarted?: (session: ActiveSession) => Promise<void> | void;
}

function appendClarifications(spec: string, questions: PendingClarification["questions"], answers: Record<string, string>) {
  const lines = questions.map((question, index) => {
    const answer = answers[question.id]?.trim() || "(not provided)";
    return `${index + 1}. ${question.text}\nAnswer: ${answer}`;
  });

  return `${spec}\n\n=== Clarifications ===\n${lines.join("\n\n")}`;
}

export function useTaskCreationFlow({ onRunStarted }: Args) {
  const creationFlow = useWorkspaceStore(selectCreationFlow);
  const setCreationInput = useWorkspaceStore((state) => state.setCreationInput);
  const setCreationStage = useWorkspaceStore((state) => state.setCreationStage);
  const setCreationMessages = useWorkspaceStore((state) => state.setCreationMessages);
  const appendCreationMessage = useWorkspaceStore((state) => state.appendCreationMessage);
  const setCreationPendingClarification = useWorkspaceStore((state) => state.setCreationPendingClarification);
  const setCreationPendingPRD = useWorkspaceStore((state) => state.setCreationPendingPRD);
  const resetCreationFlow = useWorkspaceStore((state) => state.resetCreationFlow);
  const setChatMessages = useExecutionStore((state) => state.setChatMessages);

  const pushMessage = useCallback((message: Message) => {
    appendCreationMessage(message);
  }, [appendCreationMessage]);

  const startRun = useCallback(async (spec: string, nextMessages: Message[]) => {
    try {
      setCreationStage("starting_run");
      const result = await runSpec({ spec });
      if (!result.ok || !result.projectId || !result.sessionId) {
        return { ok: false as const, error: result.error ?? "Run failed" };
      }

      const session = { projectId: result.projectId, sessionId: result.sessionId };
      setChatMessages(session, nextMessages);
      resetCreationFlow();
      await onRunStarted?.(session);
      return { ok: true as const };
    } catch (error) {
      return { ok: false as const, error: (error as Error).message };
    }
  }, [onRunStarted, resetCreationFlow, setChatMessages, setCreationStage]);

  const generatePRDForSpec = useCallback(async (spec: string, baseMessages?: Message[]) => {
    try {
      const prd = await generatePRD(spec);
      setCreationMessages([
        ...(baseMessages ?? creationFlow.messages),
        { role: "ai", text: "I drafted a PRD for this task. Review it below before starting execution." },
        { role: "prd", prd, confirmed: false },
      ]);
      setCreationPendingPRD({ originalSpec: spec });
      setCreationPendingClarification(null);
      setCreationStage("reviewing_prd");
    } catch (error) {
      const fallbackMessages = [
        ...(baseMessages ?? creationFlow.messages),
        { role: "system", text: "PRD generation failed, so I will try starting the run directly." } satisfies Message,
      ];
      setCreationMessages(fallbackMessages);
      const result = await startRun(spec, fallbackMessages);
      if (!result.ok) {
        appendCreationMessage({ role: "system", text: `Failed: ${result.error}` });
        setCreationStage("drafting");
      }
      if (error instanceof Error) {
        console.debug("[shipyard:task-creation] prd generation failed", error.message);
      }
    }
  }, [appendCreationMessage, creationFlow.messages, setCreationMessages, setCreationPendingClarification, setCreationPendingPRD, setCreationStage, startRun]);

  const send = useCallback(async () => {
    const text = creationFlow.input.trim();
    if (!text || creationFlow.stage === "starting_run" || creationFlow.pendingClarification || creationFlow.pendingPRD) return;

    const nextMessages = [...creationFlow.messages, { role: "user", text } satisfies Message];
    setCreationInput("");
    setCreationMessages(nextMessages);
    setCreationStage("drafting");

    try {
      const clarification = await clarifySpec(text);
      if (clarification.needsClarification && clarification.questions.length > 0) {
        setCreationMessages([
          ...nextMessages,
          { role: "ai", text: "Before I draft the PRD, I need a few clarifications." },
        ]);
        setCreationPendingClarification({ baseSpec: text, questions: clarification.questions });
        setCreationPendingPRD(null);
        setCreationStage("clarifying");
        return;
      }

      await generatePRDForSpec(text, nextMessages);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const fallbackMessages = [
        ...nextMessages,
        { role: "system", text: `Clarification failed: ${message}. Continuing with the original request.` } satisfies Message,
      ];
      setCreationMessages(fallbackMessages);
      await generatePRDForSpec(text, fallbackMessages);
    }
  }, [creationFlow.input, creationFlow.messages, creationFlow.pendingClarification, creationFlow.pendingPRD, creationFlow.stage, generatePRDForSpec, setCreationInput, setCreationMessages, setCreationPendingClarification, setCreationPendingPRD, setCreationStage]);

  const confirmClarification = useCallback(async (answers: Record<string, string>) => {
    if (!creationFlow.pendingClarification || creationFlow.stage === "starting_run") return;

    const clarifiedSpec = appendClarifications(
      creationFlow.pendingClarification.baseSpec,
      creationFlow.pendingClarification.questions,
      answers
    );

    const nextMessages = [
      ...creationFlow.messages,
      {
        role: "clarification",
        questions: creationFlow.pendingClarification.questions,
        answered: true,
        answers,
      } satisfies Message,
      { role: "ai", text: "Thanks — I incorporated your answers and will draft the PRD now." } satisfies Message,
    ];

    setCreationMessages(nextMessages);
    setCreationPendingClarification(null);
    setCreationStage("drafting");
    await generatePRDForSpec(clarifiedSpec, nextMessages);
  }, [creationFlow.messages, creationFlow.pendingClarification, creationFlow.stage, generatePRDForSpec, setCreationMessages, setCreationPendingClarification, setCreationStage]);

  const skipClarification = useCallback(async () => {
    if (!creationFlow.pendingClarification || creationFlow.stage === "starting_run") return;

    const nextMessages = [
      ...creationFlow.messages,
      { role: "system", text: "Skipped clarification. Proceeding with the original request." } satisfies Message,
    ];

    const originalSpec = creationFlow.pendingClarification.baseSpec;
    setCreationMessages(nextMessages);
    setCreationPendingClarification(null);
    setCreationStage("drafting");
    await generatePRDForSpec(originalSpec, nextMessages);
  }, [creationFlow.messages, creationFlow.pendingClarification, creationFlow.stage, generatePRDForSpec, setCreationMessages, setCreationPendingClarification, setCreationStage]);

  const confirmPRD = useCallback(async (prd: string) => {
    if (!creationFlow.pendingPRD || creationFlow.stage === "starting_run") return;

    const currentPending = creationFlow.pendingPRD;
    const confirmedMessages = creationFlow.messages.map((message): Message =>
      message.role === "prd" && !message.confirmed ? { ...message, confirmed: true, prd } : message
    );

    setCreationPendingPRD(null);
    setCreationMessages(confirmedMessages);

    const result = await startRun(prd, confirmedMessages);
    if (!result.ok) {
      setCreationPendingPRD(currentPending);
      setCreationMessages(confirmedMessages.map((message): Message =>
        message.role === "prd" ? { ...message, confirmed: false, prd } : message
      ));
      pushMessage({ role: "system", text: `Failed: ${result.error}` });
      setCreationStage("reviewing_prd");
    }
  }, [creationFlow.messages, creationFlow.pendingPRD, creationFlow.stage, pushMessage, setCreationMessages, setCreationPendingPRD, setCreationStage, startRun]);

  const discardPRD = useCallback(async () => {
    if (!creationFlow.pendingPRD || creationFlow.stage === "starting_run") return;

    const currentPending = creationFlow.pendingPRD;
    const confirmedMessages = creationFlow.messages.map((message): Message =>
      message.role === "prd" && !message.confirmed ? { ...message, confirmed: true } : message
    );

    setCreationPendingPRD(null);
    setCreationMessages(confirmedMessages);

    const result = await startRun(currentPending.originalSpec, confirmedMessages);
    if (!result.ok) {
      setCreationPendingPRD(currentPending);
      setCreationMessages(confirmedMessages.map((message): Message =>
        message.role === "prd" ? { ...message, confirmed: false } : message
      ));
      pushMessage({ role: "system", text: `Failed: ${result.error}` });
      setCreationStage("reviewing_prd");
    }
  }, [creationFlow.messages, creationFlow.pendingPRD, creationFlow.stage, pushMessage, setCreationMessages, setCreationPendingPRD, setCreationStage, startRun]);

  const stageLabel = creationFlow.stage === "starting_run"
    ? "Starting run"
    : creationFlow.stage === "clarifying"
      ? "Need clarification"
      : creationFlow.stage === "reviewing_prd"
        ? "Review PRD"
        : creationFlow.stage === "drafting"
          ? "Refine task"
          : "Describe task";

  const composerDisabled = creationFlow.stage === "starting_run" || Boolean(creationFlow.pendingClarification) || Boolean(creationFlow.pendingPRD);
  const composerHint = creationFlow.pendingClarification
    ? "Answer the clarification card to continue."
    : creationFlow.pendingPRD
      ? "Review the PRD card and confirm before execution starts."
      : "Tip: use Ctrl/Cmd + Enter to submit.";

  return {
    input: creationFlow.input,
    loading: creationFlow.stage === "starting_run",
    messages: creationFlow.messages,
    pendingClarification: creationFlow.pendingClarification,
    pendingPRD: creationFlow.pendingPRD,
    stage: creationFlow.stage,
    stageLabel,
    composerDisabled,
    composerHint,
    setInput: setCreationInput,
    send,
    confirmClarification,
    skipClarification,
    confirmPRD,
    discardPRD,
  };
}
