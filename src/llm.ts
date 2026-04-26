/**
 * llm.ts — OpenAI 兼容格式的 LLM 客户端
 *
 * 替代 Claude Agent SDK 的 query()
 * 支持任何 OpenAI 兼容接口（codex 中转、one-api、litellm 等）
 *
 * 实现了完整的 tool use agent loop：
 * LLM 返回 tool_calls → 执行工具 → 结果反馈给 LLM → 直到 finish_reason=stop
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { isPathSafe, auditWrite } from "./hooks";

// ---- 配置 ----

export interface LLMClientConfig {
  baseURL: string;
  apiKey: string;
  model: string;
}

// ---- OpenAI 消息格式 ----

type Role = "system" | "user" | "assistant" | "tool";

interface Message {
  role: Role;
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface ChatResponse {
  choices: Array<{
    finish_reason: "stop" | "tool_calls" | string;
    message: Message;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

// ---- 工具定义 ----

const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "write_file",
      description: "Write content to a file. Creates parent directories if needed.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path relative to working directory" },
          content: { type: "string", description: "Complete file content" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "read_file",
      description: "Read content from a file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path to read" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "run_command",
      description: "Run a shell command. Only tsc and node commands are allowed.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Command to run" },
        },
        required: ["command"],
      },
    },
  },
];

// ---- 工具执行 ----

export interface ToolExecution {
  tool: string;
  input: Record<string, string>;
  output: string;
  success: boolean;
  filePath?: string;  // write_file 时记录路径
}

function executeTool(
  name: string,
  args: Record<string, string>,
  workDir: string
): { output: string; success: boolean; filePath?: string } {
  try {
    if (name === "write_file") {
      const filePath = path.resolve(workDir, args.path);
      // 安全检查：复用 hooks.ts
      if (!isPathSafe(args.path, workDir)) {
        return { output: `Blocked: path outside workDir`, success: false };
      }
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, args.content, "utf-8");
      auditWrite(filePath, workDir);
      const lines = args.content.split("\n").length;
      return { output: `Written: ${args.path} (${lines} lines)`, success: true, filePath: args.path };
    }

    if (name === "read_file") {
      const filePath = path.resolve(workDir, args.path);
      if (!fs.existsSync(filePath)) return { output: `File not found: ${args.path}`, success: false };
      const content = fs.readFileSync(filePath, "utf-8");
      return { output: content.slice(0, 3000), success: true };
    }

    if (name === "run_command") {
      const allowed = ["npx tsc", "tsc", "node "];
      if (!allowed.some((a) => args.command.startsWith(a))) {
        return { output: `Blocked: only tsc/node allowed`, success: false };
      }
      const out = execSync(args.command, { cwd: workDir, encoding: "utf-8", timeout: 30_000, stdio: ["pipe", "pipe", "pipe"] });
      return { output: out.trim().slice(0, 1000), success: true };
    }

    return { output: `Unknown tool: ${name}`, success: false };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    const out = [err.stdout, err.stderr, err.message].filter(Boolean).join("\n").slice(0, 500);
    return { output: out, success: false };
  }
}

// ---- Agent Loop ----

export interface AgentRunResult {
  finalText: string;
  toolExecutions: ToolExecution[];
  tokensUsed: number;
}

export async function runAgent(
  systemPrompt: string,
  userPrompt: string,
  workDir: string,
  config: LLMClientConfig,
  withTools = true,
  onToolCall?: (name: string, filePath?: string) => void
): Promise<AgentRunResult> {
  const messages: Message[] = [
    { role: "system", content: systemPrompt },
    { role: "user",   content: userPrompt },
  ];

  const toolExecutions: ToolExecution[] = [];
  let tokensUsed = 0;
  let finalText = "";
  let turns = 0;
  const MAX_TURNS = 15;

  while (turns++ < MAX_TURNS) {
    const body: Record<string, unknown> = {
      model: config.model,
      messages,
      max_tokens: 4096,
    };
    if (withTools) body.tools = TOOLS;

    const resp = await fetch(`${config.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`API ${resp.status}: ${text.slice(0, 200)}`);
    }

    const data = await resp.json() as ChatResponse;
    tokensUsed += data.usage?.total_tokens ?? 0;

    const choice = data.choices[0];
    const msg = choice.message;

    // 把 assistant 消息加入历史
    messages.push({ role: "assistant", content: msg.content, tool_calls: msg.tool_calls });

    // 完成
    if (choice.finish_reason === "stop" || !msg.tool_calls?.length) {
      finalText = msg.content ?? "";
      break;
    }

    // 执行工具调用
    for (const tc of msg.tool_calls) {
      let args: Record<string, string> = {};
      try { args = JSON.parse(tc.function.arguments) as Record<string, string>; } catch {}

      const result = executeTool(tc.function.name, args, workDir);

      toolExecutions.push({
        tool: tc.function.name,
        input: args,
        output: result.output.slice(0, 300),
        success: result.success,
        filePath: result.filePath,
      });

      if (onToolCall) onToolCall(tc.function.name, result.filePath);

      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        name: tc.function.name,
        content: result.output,
      });
    }
  }

  return { finalText, toolExecutions, tokensUsed };
}
