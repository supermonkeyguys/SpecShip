/**
 * routes/chat.ts — POST /api/chat
 *
 * 接收用户自然语言消息，LLM 判断意图，触发对应操作。
 */

import { Router, Request, Response } from "express";
import { DEFAULT_CONFIG } from "../config";
import { runAgent } from "../llm";
import { routeIntentByPolicy } from "../ai/policy";
import { ChatRequest, ChatResponse, ChatIntent } from "../types";

export const chatRouter = Router();

const DEBUG_PREFIX = "[shipyard:server:chat]";

const INTENT_PROMPT = `
You are the AI assistant for Shipyard, an AI development IDE.
You help users build software by understanding their intent and responding helpfully.

Given the user's message and current task context, determine intent AND write a genuinely helpful reply.

Output ONLY a JSON object:
{
  "type": "retry_node" | "new_run" | "resume" | "status" | "unknown",
  "nodeId": "<node id if retry_node, else null>",
  "spec": "<full spec string if new_run, else null>",
  "repoPath": "<absolute repo path if user mentions a repo/project directory, else null>",
  "reply": "<your actual response to the user — answer their question, explain errors, give advice, etc.>"
}

Intent definitions:
- retry_node: user wants to re-run a specific failed node (e.g. "retry impl-auth", "重跑 impl-auth")
- new_run: user wants to start a NEW task or clearly modify the current spec to trigger a new run (e.g. "build a blog", "帮我做一个登录页", "重新规划加上错误处理")
- resume: user wants to resume an interrupted/paused task (e.g. "resume", "继续", "恢复")
- status: user is asking about current progress (e.g. "how is it going?", "状态", "现在到哪了")
- unknown: general questions, asking about errors, chatting, seeking advice — reply conversationally and helpfully

Rules:
- reply MUST be in the same language as the user's message
- reply should ACTUALLY answer the user's question — if they ask about an error, explain it; if they ask for advice, give it
- Do NOT use generic replies like "收到" for unknown intent — have a real conversation
- new_run ONLY when user clearly wants to START or RESTART execution, not for casual questions
- If new_run, spec must be the complete task description (incorporate any modifications the user mentioned)
- If retry_node, nodeId must exactly match one of the node IDs provided in context
- Keep replies concise but genuinely useful (2-4 sentences for complex questions, 1-2 for simple ones)
`.trim();

chatRouter.post("/chat", async (req: Request, res: Response) => {
  const { message, currentNodes, currentSpec, llm } = req.body as ChatRequest;

  if (!message?.trim()) {
    res.status(400).json({ ok: false, intent: { type: "unknown", reply: "Empty message" } } satisfies ChatResponse);
    return;
  }

  const config = {
    ...DEFAULT_CONFIG,
    workDir: process.env.WORK_DIR ?? process.cwd(),
    baseURL: llm?.baseURL?.trim() || DEFAULT_CONFIG.baseURL,
    apiKey: llm?.apiKey?.trim() || DEFAULT_CONFIG.apiKey,
  };

  console.log(DEBUG_PREFIX, "request", { message, currentSpec, currentNodesCount: currentNodes?.length ?? 0 });

  const deterministicIntent = routeIntentByPolicy({ message, currentNodes: currentNodes as Parameters<typeof routeIntentByPolicy>[0]["currentNodes"], currentSpec });
  if (deterministicIntent) {
    console.log(DEBUG_PREFIX, "route=policy", deterministicIntent);
    res.json({ ok: true, intent: deterministicIntent } satisfies ChatResponse);
    return;
  }

  // 仅使用前端显式传来的上下文；不要再隐式注入全局 checkpoint，避免污染路由判断
  const contextLines: string[] = [];
  if (currentSpec) {
    contextLines.push(`Current spec: ${currentSpec}`);
  }
  if (currentNodes?.length) {
    contextLines.push("Current nodes:");
    for (const n of currentNodes) {
      contextLines.push(`  - ${n.id} (${n.title}): ${n.status}`);
    }
  }

  const userMessage = contextLines.length
    ? `${contextLines.join("\n")}\n\nUser message: ${message}`
    : `User message: ${message}`;

  try {
    const { finalText } = await runAgent(
      INTENT_PROMPT,
      userMessage,
      config.workDir,
      { baseURL: config.baseURL, apiKey: config.apiKey, model: config.models.planning },
      false
    );

    // 解析 LLM 返回的 JSON
    const match = finalText.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON in response");

    const parsed = JSON.parse(match[0]) as {
      type: string;
      nodeId?: string;
      spec?: string;
      repoPath?: string;
      reply: string;
    };

    let intent: ChatIntent;
    switch (parsed.type) {
      case "retry_node":
        intent = { type: "retry_node", nodeId: parsed.nodeId ?? "", reply: parsed.reply };
        break;
      case "new_run":
        intent = { type: "new_run", spec: parsed.spec ?? message, repoPath: parsed.repoPath, reply: parsed.reply };
        break;
      case "status":
        intent = { type: "status", reply: parsed.reply };
        break;
      case "resume":
        intent = { type: "resume", reply: parsed.reply };
        break;
      default:
        intent = { type: "unknown", reply: parsed.reply ?? "I'm not sure what you mean. Try: retry a node, start a new task, or ask for status." };
    }

    console.log(DEBUG_PREFIX, "route=llm", { parsed, finalIntent: intent });
    res.json({ ok: true, intent } satisfies ChatResponse);
  } catch (e) {
    res.status(500).json({
      ok: false,
      intent: { type: "unknown", reply: "Sorry, I couldn't understand that." },
      error: (e as Error).message,
    } satisfies ChatResponse);
  }
});
