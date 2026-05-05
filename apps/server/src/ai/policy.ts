import type { ChatIntent, NodeStatus } from "../types";

interface RouteIntentInput {
  message: string;
  currentNodes?: Array<Pick<NodeStatus, "id" | "title" | "status">>;
  currentSpec?: string;
}

const CHINESE_RE = /[\u3400-\u9fff]/;
const STATUS_RE = /^(status|progress|what('?s| is) the status|how('?s| is) it going|进度|状态|现在怎么样|进行到哪|到哪了|情况怎么样)[?.!\s]*$/i;
const RESUME_RE = /^(resume|continue|continue run|continue task|恢复|继续|继续执行|恢复执行|接着跑|接着执行)[!.?\s]*$/i;
const RETRY_RE = /(retry|rerun|re-run|try again|重试|重跑|重新跑)/i;

function isChinese(text: string): boolean {
  return CHINESE_RE.test(text);
}

function say(message: string, zh: string, en: string): string {
  return isChinese(message) ? zh : en;
}

function normalizeMessage(message: string): string {
  return message.trim().replace(/\s+/g, " ").toLowerCase();
}

function matchRetryNode(
  message: string,
  currentNodes: Array<Pick<NodeStatus, "id" | "title" | "status">>
): ChatIntent | null {
  if (!RETRY_RE.test(message)) return null;

  const lowered = normalizeMessage(message);
  const failedNodes = currentNodes.filter((node) => node.status === "failed");

  const directMatch = currentNodes.find((node) => {
    const id = node.id.toLowerCase();
    const title = node.title.toLowerCase();
    return lowered.includes(id) || title.split(/\s+/).some((part) => part.length > 2 && lowered.includes(part));
  });

  if (directMatch) {
    return {
      type: "retry_node",
      nodeId: directMatch.id,
      reply: say(message, `收到，我来重试节点 ${directMatch.id}。`, `Got it — I'll retry node ${directMatch.id}.`),
    };
  }

  if (failedNodes.length === 1) {
    return {
      type: "retry_node",
      nodeId: failedNodes[0].id,
      reply: say(message, `收到，我来重试失败节点 ${failedNodes[0].id}。`, `Got it — I'll retry the failed node ${failedNodes[0].id}.`),
    };
  }

  return null;
}

export function routeIntentByPolicy(input: RouteIntentInput): ChatIntent | null {
  const rawMessage = input.message.trim();
  if (!rawMessage) return null;

  const message = normalizeMessage(rawMessage);

  if (STATUS_RE.test(message)) {
    return {
      type: "status",
      reply: say(rawMessage, "收到，我来查看当前执行状态。", "Sure — I'll check the current execution status."),
    };
  }

  if (RESUME_RE.test(message)) {
    // 只有当前真的有未完成节点时才触发 resume，否则让 LLM 正常回答
    const hasResumable = (input.currentNodes ?? []).some(
      (n) => n.status === "failed" || n.status === "running"
    );
    if (hasResumable && input.currentSpec) {
      return {
        type: "resume",
        reply: say(rawMessage, "收到，我继续当前可恢复的任务。", "Sure — I'll resume the current recoverable task."),
      };
    }
    // 没有可恢复内容，交给 LLM 回答（避免触发无效 resume 请求）
    return null;
  }

  const retryIntent = matchRetryNode(rawMessage, input.currentNodes ?? []);
  if (retryIntent) return retryIntent;

  // new_run 及其他所有意图一律交给 LLM 判断，避免正则误匹配导致复用固定回复
  return null;
}
