import type { ActiveSession } from "../../features/session/types";
import type { ChatIntent, ClarifyQuestion, NodeStatus } from "../../types";
import { chatIntent } from "../../shared/api/chatClient";
import { clarifySpec } from "../../shared/api/clarifyClient";
import { retryNode } from "../../shared/api/nodeClient";
import { runSpec } from "../../shared/api/runClient";

interface SendContext {
  message: string;
  currentNodes: Array<Pick<NodeStatus, "id" | "title" | "status">>;
  currentSpec?: string;
  activeSession: ActiveSession | null;
}

export interface ClarificationPending {
  spec: string;
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
      const data = await chatIntent({
        message: input.message,
        currentNodes: input.currentNodes,
        currentSpec: input.currentSpec,
      });

      const text = data.intent.reply;
      const intent: ChatIntent = data.intent;

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
        try {
          const clarify = await clarifySpec(intent.spec);
          if (clarify.needsClarification && clarify.questions?.length) {
            return {
              type: "clarification",
              text,
              pending: { spec: intent.spec, repoPath: intent.repoPath },
              questions: clarify.questions,
            };
          }
        } catch {
        }

        const runResult = await runSpecAndActivate(intent.spec, intent.repoPath);
        if (!runResult.ok) return { type: "error", text: `Failed: ${runResult.error}` };
        return { type: "reply", text };
      }

      if (intent.type === "resume") {
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
    const answerText = Object.entries(answers).map(([, v]) => v).join(", ");
    const enrichedSpec = `${pending.spec}\n\nUser clarifications: ${answerText}`;
    return runSpecAndActivate(enrichedSpec, pending.repoPath);
  }

  async function skipClarification(pending: ClarificationPending) {
    return runSpecAndActivate(pending.spec, pending.repoPath);
  }

  return {
    send,
    confirmClarification,
    skipClarification,
  };
}
