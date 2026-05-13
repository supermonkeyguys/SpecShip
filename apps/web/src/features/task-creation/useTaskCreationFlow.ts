import { useCallback } from "react";
import { useExecutionStore } from "../../domains/execution/store";
import { useWorkspaceStore } from "../../domains/workspace/store";
import { selectCreationFlow } from "../../domains/workspace/selectors";
import { clarifySpec } from "../../shared/api/clarifyClient";
import { generatePlan } from "../../shared/api/planClient";
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
  const setCreationPendingPlan = useWorkspaceStore((state) => state.setCreationPendingPlan);
  const resetCreationFlow = useWorkspaceStore((state) => state.resetCreationFlow);
  const setChatMessages = useExecutionStore((state) => state.setChatMessages);

  const pushMessage = useCallback((message: Message) => {
    appendCreationMessage(message);
  }, [appendCreationMessage]);

  const startRun = useCallback(async (plan: string, nextMessages: Message[]) => {
    try {
      setCreationStage("starting_run");
      const result = await runSpec({ spec: plan, mode: "plan" });
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

  const generatePlanForSpec = useCallback(async (spec: string, baseMessages?: Message[]) => {
    try {
      const plan = await generatePlan(spec);
      setCreationMessages([
        ...(baseMessages ?? creationFlow.messages),
        { role: "ai", text: "I drafted an execution plan for this task. Review it below before starting." },
        { role: "plan", plan, confirmed: false },
      ]);
      setCreationPendingPlan({ originalSpec: spec });
      setCreationPendingClarification(null);
      setCreationStage("reviewing_plan");
    } catch (error) {
      const fallbackMessages = [
        ...(baseMessages ?? creationFlow.messages),
        { role: "system", text: "Plan generation failed, trying to start directly." } satisfies Message,
      ];
      setCreationMessages(fallbackMessages);
      const result = await startRun(spec, fallbackMessages);
      if (!result.ok) {
        appendCreationMessage({ role: "system", text: `Failed: ${result.error}` });
        setCreationStage("drafting");
      }
      if (error instanceof Error) {
        console.debug("[shipyard:task-creation] plan generation failed", error.message);
      }
    }
  }, [appendCreationMessage, creationFlow.messages, setCreationMessages, setCreationPendingClarification, setCreationPendingPlan, setCreationStage, startRun]);

  const send = useCallback(async () => {
    const text = creationFlow.input.trim();
    if (!text || creationFlow.stage === "starting_run" || creationFlow.pendingClarification || creationFlow.pendingPlan) return;

    const nextMessages = [...creationFlow.messages, { role: "user", text } satisfies Message];
    setCreationInput("");
    setCreationMessages(nextMessages);
    setCreationStage("drafting");

    try {
      const clarification = await clarifySpec(text);
      if (clarification.needsClarification && clarification.questions.length > 0) {
        setCreationMessages([
          ...nextMessages,
          { role: "ai", text: "Before I draft the plan, I need a few clarifications." },
        ]);
        setCreationPendingClarification({ baseSpec: text, questions: clarification.questions });
        setCreationPendingPlan(null);
        setCreationStage("clarifying");
        return;
      }
      await generatePlanForSpec(text, nextMessages);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const fallbackMessages = [
        ...nextMessages,
        { role: "system", text: `Clarification failed: ${message}. Continuing.` } satisfies Message,
      ];
      setCreationMessages(fallbackMessages);
      await generatePlanForSpec(text, fallbackMessages);
    }
  }, [creationFlow.input, creationFlow.messages, creationFlow.pendingClarification, creationFlow.pendingPlan, creationFlow.stage, generatePlanForSpec, setCreationInput, setCreationMessages, setCreationPendingClarification, setCreationPendingPlan, setCreationStage]);

  const confirmClarification = useCallback(async (answers: Record<string, string>) => {
    if (!creationFlow.pendingClarification || creationFlow.stage === "starting_run") return;
    const clarifiedSpec = appendClarifications(
      creationFlow.pendingClarification.baseSpec,
      creationFlow.pendingClarification.questions,
      answers
    );
    const nextMessages = [
      ...creationFlow.messages,
      { role: "clarification", questions: creationFlow.pendingClarification.questions, answered: true, answers } satisfies Message,
      { role: "ai", text: "Thanks — incorporated your answers. Drafting the plan now." } satisfies Message,
    ];
    setCreationMessages(nextMessages);
    setCreationPendingClarification(null);
    setCreationStage("drafting");
    await generatePlanForSpec(clarifiedSpec, nextMessages);
  }, [creationFlow.messages, creationFlow.pendingClarification, creationFlow.stage, generatePlanForSpec, setCreationMessages, setCreationPendingClarification, setCreationStage]);

  const skipClarification = useCallback(async () => {
    if (!creationFlow.pendingClarification || creationFlow.stage === "starting_run") return;
    const nextMessages = [
      ...creationFlow.messages,
      { role: "system", text: "Skipped clarification. Proceeding." } satisfies Message,
    ];
    const originalSpec = creationFlow.pendingClarification.baseSpec;
    setCreationMessages(nextMessages);
    setCreationPendingClarification(null);
    setCreationStage("drafting");
    await generatePlanForSpec(originalSpec, nextMessages);
  }, [creationFlow.messages, creationFlow.pendingClarification, creationFlow.stage, generatePlanForSpec, setCreationMessages, setCreationPendingClarification, setCreationStage]);

  const confirmPlan = useCallback(async (plan: string) => {
    if (!creationFlow.pendingPlan || creationFlow.stage === "starting_run") return;
    const currentPending = creationFlow.pendingPlan;
    const confirmedMessages = creationFlow.messages.map((message): Message =>
      message.role === "plan" && !message.confirmed ? { ...message, confirmed: true, plan } : message
    );
    setCreationPendingPlan(null);
    setCreationMessages(confirmedMessages);
    const result = await startRun(plan, confirmedMessages);
    if (!result.ok) {
      setCreationPendingPlan(currentPending);
      setCreationMessages(confirmedMessages.map((message): Message =>
        message.role === "plan" ? { ...message, confirmed: false, plan } : message
      ));
      pushMessage({ role: "system", text: `Failed: ${result.error}` });
      setCreationStage("reviewing_plan");
    }
  }, [creationFlow.messages, creationFlow.pendingPlan, creationFlow.stage, pushMessage, setCreationMessages, setCreationPendingPlan, setCreationStage, startRun]);

  const discardPlan = useCallback(async () => {
    if (!creationFlow.pendingPlan || creationFlow.stage === "starting_run") return;
    const currentPending = creationFlow.pendingPlan;
    const confirmedMessages = creationFlow.messages.map((message): Message =>
      message.role === "plan" && !message.confirmed ? { ...message, confirmed: true } : message
    );
    setCreationPendingPlan(null);
    setCreationMessages(confirmedMessages);
    const result = await startRun(currentPending.originalSpec, confirmedMessages);
    if (!result.ok) {
      setCreationPendingPlan(currentPending);
      setCreationMessages(confirmedMessages.map((message): Message =>
        message.role === "plan" ? { ...message, confirmed: false } : message
      ));
      pushMessage({ role: "system", text: `Failed: ${result.error}` });
      setCreationStage("reviewing_plan");
    }
  }, [creationFlow.messages, creationFlow.pendingPlan, creationFlow.stage, pushMessage, setCreationMessages, setCreationPendingPlan, setCreationStage, startRun]);

  const stageLabel = creationFlow.stage === "starting_run"
    ? "Starting run"
    : creationFlow.stage === "clarifying"
      ? "Need clarification"
      : creationFlow.stage === "reviewing_plan"
        ? "Review Plan"
        : creationFlow.stage === "drafting"
          ? "Refine task"
          : "Describe task";

  const composerDisabled = creationFlow.stage === "starting_run" || Boolean(creationFlow.pendingClarification) || Boolean(creationFlow.pendingPlan);
  const composerHint = creationFlow.pendingClarification
    ? "Answer the clarification card to continue."
    : creationFlow.pendingPlan
      ? "Review the plan and confirm before execution starts."
      : "Tip: use Ctrl/Cmd + Enter to submit.";

  return {
    input: creationFlow.input,
    loading: creationFlow.stage === "starting_run",
    messages: creationFlow.messages,
    pendingClarification: creationFlow.pendingClarification,
    pendingPlan: creationFlow.pendingPlan,
    stage: creationFlow.stage,
    stageLabel,
    composerDisabled,
    composerHint,
    setInput: setCreationInput,
    send,
    confirmClarification,
    skipClarification,
    confirmPlan,
    discardPlan,
  };
}
