import type { ActiveSession } from "../../features/session/types";
import type { ChatIntent, NodeStatus } from "../../types";
import { chatIntent } from "../../shared/api/chatClient";
import { generatePlan } from "../../shared/api/planClient";
import { retryNode } from "../../shared/api/nodeClient";
import { runSpec } from "../../shared/api/runClient";

const DEBUG_PREFIX = "[shipyard:chat-debug]";

interface SendContext {
  message: string;
  currentNodes: Array<Pick<NodeStatus, "id" | "title" | "status">>;
  currentSpec?: string;
  activeSession: ActiveSession | null;
}

export interface PlanPending {
  originalSpec: string;
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
        await deps.onRunStarted?.({ projectId: d.projectId, sessionId: d.sessionId });
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  async function send(input: SendContext): Promise<
    | { type: "reply"; text: string }
    | { type: "plan"; text: string; plan: string; pending: PlanPending }
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

        console.debug(DEBUG_PREFIX, "plan:generate", { spec: nextSpec });
        try {
          const plan = await generatePlan(nextSpec);
          return {
            type: "plan",
            text,
            plan,
            pending: { originalSpec: nextSpec, repoPath: intent.repoPath },
          };
        } catch (e) {
          // Plan 生成失败时降级：直接执行原始 spec
          console.debug(DEBUG_PREFIX, "plan:error — falling back to direct run", e);
          const runResult = await runSpecAndActivate(nextSpec, intent.repoPath);
          if (!runResult.ok) return { type: "error", text: `Failed: ${runResult.error ?? "unknown"}` };
          return { type: "reply", text };
        }
      }

      if (intent.type === "resume") {
        if (!input.activeSession?.sessionId) {
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

  async function confirmPlan(plan: string, pending: PlanPending) {
    console.debug(DEBUG_PREFIX, "plan:confirm", { repoPath: pending.repoPath });
    return runSpecAndActivate(plan, pending.repoPath);
  }

  async function discardPlan(pending: PlanPending) {
    console.debug(DEBUG_PREFIX, "plan:discard", { originalSpec: pending.originalSpec });
    return runSpecAndActivate(pending.originalSpec, pending.repoPath);
  }

  return {
    send,
    confirmPlan,
    discardPlan,
  };
}
