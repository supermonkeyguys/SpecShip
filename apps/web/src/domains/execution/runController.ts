import type { ActiveSession } from "../../features/session/types";
import type { ChatIntent, ClarifyQuestion, NodeStatus } from "../../types";
import { chatIntent } from "../../shared/api/chatClient";
import { clarifySpec } from "../../shared/api/clarifyClient";
import { retryNode } from "../../shared/api/nodeClient";
import { runSpec } from "../../shared/api/runClient";

const DEBUG_PREFIX = "[shipyard:chat-debug]";

interface SendContext {
  message: string;
  currentNodes: Array<Pick<NodeStatus, "id" | "title" | "status">>;
  currentSpec?: string;
  activeSession: ActiveSession | null;
}

export interface ClarificationPending {
  baseSpec: string;
  questions: ClarifyQuestion[];
  repoPath?: string;
}

export interface ChatRunControllerDeps {
  onRunStarted?: (session: ActiveSession) => Promise<void> | void;
  onResumeRequested?: () => Promise<void> | void;
}

export function createChatRunController(deps: ChatRunControllerDeps) {
  async function runSpecAndActivate(spec: string, repoPath?: string): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      const d = await runSpec({ spec, repoPath });
      if (!d.ok) return { ok: false, error: d.error ?? "Run failed" };
      if (d.projectId && d.sessionId) {
        await deps.onRunStarted?.({ projectId: d.projectId, sessionId: d.sessionId, spec });
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  async function send(input: SendContext): Promise<
    | { type: "reply"; text: string }
    | { type: "clarification"; text: string; pending: ClarificationPending; questions: ClarifyQuestion[] }
    | { type: "error"; text: string }
  > {
    try {
      console.debug(DEBUG_PREFIX, "send:input", {
        message: input.message,
        currentSpec: input.currentSpec,
        currentNodes: input.currentNodes,
        activeSession: input.activeSession,
      });

      const data = await chatIntent({
        message: input.message,
        currentNodes: input.currentNodes,
        currentSpec: input.currentSpec,
      });

      const text = data.intent.reply;
      const intent: ChatIntent = data.intent;

      console.debug(DEBUG_PREFIX, "chat:intent", intent);

      if (intent.type === "retry_node") {
        if (!input.activeSession) {
          return { type: "error", text: "Retry failed: no active session selected." };
        }
        try {
          const r = await retryNode(intent.nodeId, {
            projectId: input.activeSession.projectId,
            sessionId: input.activeSession.sessionId,
          });
          if (!r.ok) return { type: "error", text: `Retry failed: ${r.error ?? "unknown"}` };
        } catch (e) {
          return { type: "error", text: `Retry failed: ${(e as Error).message}` };
        }
        return { type: "reply", text };
      }

      if (intent.type === "new_run") {
        const nextSpec = intent.spec;

        try {
          const clarify = await clarifySpec(nextSpec);
          console.debug(DEBUG_PREFIX, "clarify:response", clarify);
          if (clarify.needsClarification && clarify.questions?.length) {
            return {
              type: "clarification",
              text,
              pending: { baseSpec: nextSpec, questions: clarify.questions, repoPath: intent.repoPath },
              questions: clarify.questions,
            };
          }
        } catch (e) {
          console.debug(DEBUG_PREFIX, "clarify:error", e);
        }

        console.debug(DEBUG_PREFIX, "run:direct", { spec: nextSpec, repoPath: intent.repoPath });
        const runResult = await runSpecAndActivate(nextSpec, intent.repoPath);
        if (!runResult.ok) return { type: "error", text: `Failed: ${runResult.error}` };
        return { type: "reply", text };
      }

      if (intent.type === "resume") {
        if (!input.activeSession) {
          return { type: "reply", text };
        }
        try {
          await deps.onResumeRequested?.();
        } catch (e) {
          return { type: "error", text: `Resume failed: ${(e as Error).message}` };
        }
        return { type: "reply", text };
      }

      return { type: "reply", text };
    } catch (e) {
      return { type: "error", text: `Error: ${(e as Error).message}` };
    }
  }

  async function confirmClarification(pending: ClarificationPending, answers: Record<string, string>) {
    const clarificationLines = pending.questions
      .map((question) => {
        const answer = answers[question.id];
        return answer ? `- ${question.text}: ${answer}` : null;
      })
      .filter((line): line is string => line !== null);

    const enrichedSpec = clarificationLines.length
      ? `${pending.baseSpec}\n\nClarifications:\n${clarificationLines.join("\n")}`
      : pending.baseSpec;

    console.debug(DEBUG_PREFIX, "clarify:confirm", { answers, enrichedSpec, repoPath: pending.repoPath });
    return runSpecAndActivate(enrichedSpec, pending.repoPath);
  }

  async function skipClarification(pending: ClarificationPending) {
    console.debug(DEBUG_PREFIX, "clarify:skip", { baseSpec: pending.baseSpec, repoPath: pending.repoPath });
    return runSpecAndActivate(pending.baseSpec, pending.repoPath);
  }

  return {
    send,
    confirmClarification,
    skipClarification,
  };
}
