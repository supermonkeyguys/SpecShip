/**
 * routes/chat.ts — POST /api/chat
 *
 * 接收用户自然语言消息，LLM 判断意图，触发对应操作。
 */

import { Router, Request, Response } from "express";
import { DEFAULT_CONFIG } from "../../src/config";
import { runAgent } from "../../src/llm";
import { loadGraphCheckpoint } from "../../src/checkpoint";
import { ChatRequest, ChatResponse, ChatIntent } from "../types";

export const chatRouter = Router();

const INTENT_PROMPT = `
You are the AI assistant for Shipyard, an AI development IDE.

Given the user's message and the current task state, determine the user's intent and respond naturally.

Output ONLY a JSON object:
{
  "type": "retry_node" | "new_run" | "resume" | "status" | "unknown",
  "nodeId": "<node id if retry_node, else null>",
  "spec": "<new or modified spec if new_run, else null>",
  "repoPath": "<absolute repo path if user mentions a repo/project directory, else null>",
  "reply": "<friendly reply to show the user>"
}

Intent definitions:
- retry_node: user wants to re-run a specific failed node (e.g. "retry impl-auth", "重跑 impl-auth")
- new_run: user wants to start a new task or modify the current spec (e.g. "add error handling", "重新规划", "in repo /path/to/project, add login")
- resume: user wants to resume an interrupted task (e.g. "resume", "继续", "恢复")
- status: user is asking about current progress (e.g. "how is it going?", "状态")
- unknown: anything else

Rules:
- reply must be in the same language as the user's message
- If retry_node, nodeId must match one of the node IDs in the current state
- If new_run and user modified the spec, incorporate their changes into the new spec
- Keep replies concise (1-2 sentences)
`.trim();

chatRouter.post("/chat", async (req: Request, res: Response) => {
  const { message, currentNodes, currentSpec } = req.body as ChatRequest;

  if (!message?.trim()) {
    res.status(400).json({ ok: false, intent: { type: "unknown", reply: "Empty message" } } satisfies ChatResponse);
    return;
  }

  const config = {
    ...DEFAULT_CONFIG,
    workDir: process.cwd(),
  };

  // 构建上下文：当前节点状态 + 当前 spec
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

  // 尝试从 checkpoint 补充上下文
  try {
    const graph = loadGraphCheckpoint(config.workDir);
    if (!currentSpec && graph.originalSpec) {
      contextLines.unshift(`Current spec: ${graph.originalSpec}`);
    }
    if (!currentNodes?.length) {
      contextLines.push("Current nodes:");
      for (const [id, node] of graph.nodes.entries()) {
        contextLines.push(`  - ${id} (${node.title}): ${node.status}`);
      }
    }
  } catch {
    // 没有 checkpoint，用前端传来的上下文
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
      default:
        intent = { type: "unknown", reply: parsed.reply ?? "I'm not sure what you mean. Try: retry a node, start a new task, or ask for status." };
    }

    res.json({ ok: true, intent } satisfies ChatResponse);
  } catch (e) {
    res.status(500).json({
      ok: false,
      intent: { type: "unknown", reply: "Sorry, I couldn't understand that." },
      error: (e as Error).message,
    } satisfies ChatResponse);
  }
});
