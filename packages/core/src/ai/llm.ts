/**
 * llm.ts — OpenAI 兼容格式的 LLM 客户端
 *
 * 默认优先走 /responses（stream SSE），失败后回退 /chat/completions。
 */

import * as fs from "fs";
import * as path from "path";
import { execSync, spawnSync } from "child_process";
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

interface EndpointChoiceResult {
  choice: ChatResponse["choices"][number];
  tokensUsed: number;
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
      description: "Run a shell command. Allowed: tsc, node, npm, npx commands.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Command to run" },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_files",
      description: "Search for a pattern in files within the working directory. Returns matching lines with file paths and line numbers.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Search pattern (regex or literal string)" },
          glob: { type: "string", description: "File glob pattern to limit search, e.g. '**/*.ts'. Defaults to all files." },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_dir",
      description: "List files and directories at a given path within the working directory.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Directory path relative to working directory. Defaults to '.' (root)." },
        },
        required: [],
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
  filePath?: string;
}

function executeTool(
  name: string,
  args: Record<string, string>,
  workDir: string
): { output: string; success: boolean; filePath?: string } {
  try {
    if (name === "write_file") {
      const filePath = path.resolve(workDir, args.path);
      if (!isPathSafe(args.path, workDir)) {
        return { output: "Blocked: path outside workDir", success: false };
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
      const allowed = ["npx tsc", "tsc", "node ", "npm install", "npm run", "npm test", "npm ci", "npx "];
      if (!allowed.some((a) => args.command.startsWith(a))) {
        return { output: "Blocked: only tsc/node/npm/npx commands allowed", success: false };
      }
      const out = execSync(args.command, {
        cwd: workDir,
        encoding: "utf-8",
        timeout: 60_000,
        stdio: ["pipe", "pipe", "pipe"],
      });
      return { output: out.trim().slice(0, 1000), success: true };
    }

    if (name === "search_files") {
      const pattern = args.pattern ?? "";
      if (!pattern) return { output: "pattern is required", success: false };
      const glob = args.glob ?? "";
      // prefer ripgrep, fall back to grep
      const rgAvailable = spawnSync("which", ["rg"], { encoding: "utf-8" }).status === 0;
      let cmd: string;
      if (rgAvailable) {
        const globArg = glob ? `--glob '${glob}'` : "";
        cmd = `rg --line-number --no-heading ${globArg} '${pattern.replace(/'/g, "'\\''")}' .`;
      } else {
        const includeArg = glob ? `--include='${glob}'` : "";
        cmd = `grep -rn ${includeArg} '${pattern.replace(/'/g, "'\\''")}' .`;
      }
      try {
        const out = execSync(cmd, { cwd: workDir, encoding: "utf-8", timeout: 15_000, stdio: ["pipe", "pipe", "pipe"] });
        return { output: out.trim().slice(0, 2000) || "(no matches)", success: true };
      } catch (e: unknown) {
        const err = e as { status?: number; stdout?: string; stderr?: string };
        // exit code 1 means no matches (not an error)
        if (err.status === 1) return { output: "(no matches)", success: true };
        return { output: (err.stderr ?? "search error").slice(0, 300), success: false };
      }
    }

    if (name === "list_dir") {
      const dirPath = path.resolve(workDir, args.path ?? ".");
      if (!dirPath.startsWith(path.resolve(workDir))) {
        return { output: "Blocked: path outside workDir", success: false };
      }
      if (!fs.existsSync(dirPath)) return { output: `Directory not found: ${args.path ?? "."}`, success: false };
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      const lines = entries.map((e) => `${e.isDirectory() ? "d" : "f"}  ${e.name}`).join("\n");
      return { output: lines.slice(0, 2000) || "(empty)", success: true };
    }

    return { output: `Unknown tool: ${name}`, success: false };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    const out = [err.stdout, err.stderr, err.message].filter(Boolean).join("\n").slice(0, 500);
    return { output: out, success: false };
  }
}

// ---- /responses helpers ----

function buildResponsesInput(messages: Message[]): unknown[] {
  const items: unknown[] = [];

  for (const msg of messages) {
    if (msg.role === "tool") {
      items.push({
        type: "function_call_output",
        call_id: msg.tool_call_id ?? "",
        output: msg.content ?? "",
      });
      continue;
    }

    if (msg.role === "assistant" && msg.tool_calls?.length) {
      if (msg.content) {
        items.push({ role: "assistant", content: msg.content });
      }
      for (const tc of msg.tool_calls) {
        items.push({
          type: "function_call",
          call_id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments,
        });
      }
      continue;
    }

    const role = msg.role === "system" ? "developer" : msg.role;
    items.push({ role, content: msg.content ?? "" });
  }

  return items;
}

function parseSseDataLines(ssePayload: string): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [];
  const lines = ssePayload.split(/\r?\n/);

  for (const line of lines) {
    if (!line.startsWith("data:")) continue;
    const raw = line.slice(5).trim();
    if (!raw || raw === "[DONE]") continue;

    try {
      events.push(JSON.parse(raw) as Record<string, unknown>);
    } catch {
      // ignore malformed lines
    }
  }

  return events;
}

function extractMessageTextFromResponsesOutput(output: unknown): string {
  if (!Array.isArray(output)) return "";

  const parts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const typed = item as { type?: unknown; content?: unknown; text?: unknown };

    if (typed.type === "message") {
      const content = typed.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          if (!c || typeof c !== "object") continue;
          const piece = c as { type?: unknown; text?: unknown; value?: unknown };
          if (piece.type === "output_text" && typeof piece.text === "string") {
            parts.push(piece.text);
          } else if (typeof piece.text === "string") {
            parts.push(piece.text);
          } else if (typeof piece.value === "string") {
            parts.push(piece.value);
          }
        }
      } else if (typeof content === "string") {
        parts.push(content);
      }
    } else if (typed.type === "output_text" && typeof typed.text === "string") {
      parts.push(typed.text);
    }
  }

  return parts.join("\n").trim();
}

function extractToolCallsFromResponsesOutput(output: unknown): ToolCall[] {
  if (!Array.isArray(output)) return [];

  const toolCalls: ToolCall[] = [];
  for (let i = 0; i < output.length; i++) {
    const item = output[i];
    if (!item || typeof item !== "object") continue;

    const typed = item as {
      type?: unknown;
      id?: unknown;
      call_id?: unknown;
      name?: unknown;
      arguments?: unknown;
    };

    if (typed.type !== "function_call" || typeof typed.name !== "string") continue;

    const callId = typeof typed.call_id === "string"
      ? typed.call_id
      : typeof typed.id === "string"
        ? typed.id
        : `tool_call_${Date.now()}_${i}`;

    const args = typeof typed.arguments === "string"
      ? typed.arguments
      : JSON.stringify(typed.arguments ?? {});

    toolCalls.push({
      id: callId,
      type: "function",
      function: {
        name: typed.name,
        arguments: args,
      },
    });
  }

  return toolCalls;
}

async function readResponsesBody(resp: Response): Promise<string> {
  const contentType = (resp.headers.get("content-type") ?? "").toLowerCase();
  const raw = await resp.text();

  if (!contentType.includes("text/event-stream")) {
    return raw;
  }

  const events = parseSseDataLines(raw);
  const completed = events
    .slice()
    .reverse()
    .find((ev) => ev.type === "response.completed" && typeof ev.response === "object") as
      | { response?: unknown }
      | undefined;

  if (!completed || typeof completed.response !== "object" || !completed.response) {
    return JSON.stringify({ error: { message: "SSE stream missing response.completed event" } });
  }

  return JSON.stringify(completed.response);
}

function normalizeResponsesError(raw: string): string {
  if (!raw.trim()) return "";

  try {
    const parsed = JSON.parse(raw) as { detail?: unknown; error?: { message?: unknown }; message?: unknown };
    if (typeof parsed.detail === "string") return parsed.detail;
    if (typeof parsed.error?.message === "string") return parsed.error.message;
    if (typeof parsed.message === "string") return parsed.message;
  } catch {
    // ignore
  }

  return raw;
}

async function callResponsesAPI(
  messages: Message[],
  withTools: boolean,
  config: LLMClientConfig
): Promise<EndpointChoiceResult> {
  const endpoint = `${config.baseURL}/responses`;
  const body: Record<string, unknown> = {
    model: config.model,
    input: buildResponsesInput(messages),
    max_output_tokens: 4096,
    stream: true,
  };
  if (withTools) {
    body.tools = TOOLS.map((t) => ({
      type: t.type,
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    }));
  }

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const raw = await readResponsesBody(resp);

  if (!resp.ok) {
    const normalized = normalizeResponsesError(raw);
    throw new Error(`API ${resp.status} (${endpoint}): ${(normalized || raw).slice(0, 200)}`);
  }

  if (!raw.trim()) {
    throw new Error(`API returned empty body (${endpoint}). This proxy may be incompatible or temporarily unhealthy.`);
  }

  let data: {
    output_text?: unknown;
    output?: unknown;
    usage?: { total_tokens?: unknown };
    error?: { message?: unknown };
  };

  try {
    data = JSON.parse(raw) as {
      output_text?: unknown;
      output?: unknown;
      usage?: { total_tokens?: unknown };
      error?: { message?: unknown };
    };
  } catch {
    throw new Error(`API returned non-JSON body (${endpoint}): ${raw.slice(0, 200)}`);
  }

  const outputText = typeof data.output_text === "string"
    ? data.output_text
    : extractMessageTextFromResponsesOutput(data.output);
  const toolCalls = extractToolCallsFromResponsesOutput(data.output);

  if (!outputText && !toolCalls.length) {
    const normalized = normalizeResponsesError(raw);
    throw new Error(`API returned unexpected response schema (${endpoint}): ${normalized.slice(0, 200)}`);
  }

  return {
    choice: {
      finish_reason: toolCalls.length ? "tool_calls" : "stop",
      message: {
        role: "assistant",
        content: outputText || null,
        tool_calls: toolCalls.length ? toolCalls : undefined,
      },
    },
    tokensUsed: typeof data.usage?.total_tokens === "number" ? data.usage.total_tokens : 0,
  };
}

// ---- /chat/completions fallback ----

async function callChatCompletionsAPI(
  messages: Message[],
  withTools: boolean,
  config: LLMClientConfig
): Promise<EndpointChoiceResult> {
  const endpoint = `${config.baseURL}/chat/completions`;
  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    max_tokens: 4096,
  };
  if (withTools) body.tools = TOOLS;

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const raw = await resp.text();

  if (!resp.ok) {
    throw new Error(`API ${resp.status} (${endpoint}): ${raw.slice(0, 200)}`);
  }

  if (!raw.trim()) {
    throw new Error(`API returned empty body (${endpoint}). This proxy may be incompatible or temporarily unhealthy.`);
  }

  // 代理可能返回 SSE 流格式（data: {...}\n），需要先合并再解析
  const contentType = (resp.headers.get("content-type") ?? "").toLowerCase();
  const isSseBody = contentType.includes("text/event-stream") || raw.trimStart().startsWith("data:");
  if (isSseBody) {
    return assembleFromSseChunks(raw, endpoint);
  }

  let data: ChatResponse;
  try {
    data = JSON.parse(raw) as ChatResponse;
  } catch {
    throw new Error(`API returned non-JSON body (${endpoint}): ${raw.slice(0, 200)}`);
  }

  if (!Array.isArray(data.choices) || data.choices.length === 0 || !data.choices[0]?.message) {
    throw new Error(`API returned unexpected response schema (${endpoint}): ${raw.slice(0, 200)}`);
  }

  return {
    choice: data.choices[0],
    tokensUsed: data.usage?.total_tokens ?? 0,
  };
}

function assembleFromSseChunks(sseBody: string, endpoint: string): EndpointChoiceResult {
  const chunks = parseSseDataLines(sseBody);
  let contentParts: string[] = [];
  let toolCallMap: Map<number, { id: string; name: string; args: string }> = new Map();
  let finishReason = "stop";
  let tokensUsed = 0;

  for (const chunk of chunks) {
    const choices = chunk.choices as Array<{
      finish_reason?: string;
      delta?: { content?: string; tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> };
    }> | undefined;

    if (chunk.usage && typeof (chunk.usage as Record<string, unknown>).total_tokens === "number") {
      tokensUsed = (chunk.usage as Record<string, unknown>).total_tokens as number;
    }

    if (!Array.isArray(choices) || choices.length === 0) continue;
    const choice = choices[0];
    if (choice.finish_reason) finishReason = choice.finish_reason;

    const delta = choice.delta;
    if (!delta) continue;

    if (typeof delta.content === "string") contentParts.push(delta.content);

    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        if (!toolCallMap.has(tc.index)) {
          toolCallMap.set(tc.index, { id: tc.id ?? `tc_${tc.index}`, name: "", args: "" });
        }
        const entry = toolCallMap.get(tc.index)!;
        if (tc.id) entry.id = tc.id;
        if (tc.function?.name) entry.name += tc.function.name;
        if (tc.function?.arguments) entry.args += tc.function.arguments;
      }
    }
  }

  const content = contentParts.join("") || null;
  const toolCalls: ToolCall[] = Array.from(toolCallMap.values())
    .filter((tc) => tc.name)
    .map((tc) => ({
      id: tc.id,
      type: "function" as const,
      function: { name: tc.name, arguments: tc.args },
    }));

  if (!content && toolCalls.length === 0) {
    throw new Error(`chat/completions SSE stream produced no content or tool calls (${endpoint})`);
  }

  return {
    choice: {
      finish_reason: finishReason,
      message: {
        role: "assistant",
        content,
        tool_calls: toolCalls.length ? toolCalls : undefined,
      },
    },
    tokensUsed,
  };
}

async function callModelEndpoint(
  messages: Message[],
  withTools: boolean,
  config: LLMClientConfig
): Promise<EndpointChoiceResult> {
  const errors: string[] = [];
  const forceChatCompletions = process.env.FORCE_CHAT_COMPLETIONS === "1";

  if (!forceChatCompletions) {
    try {
      return await callResponsesAPI(messages, withTools, config);
    } catch (e) {
      errors.push(`responses: ${(e as Error).message}`);
    }
  }

  try {
    return await callChatCompletionsAPI(messages, withTools, config);
  } catch (e) {
    errors.push(`chat_completions: ${(e as Error).message}`);
  }

  console.error("[LLM] All endpoints failed:", errors.join(" | "), "| baseURL:", config.baseURL, "| apiKey:", config.apiKey ? config.apiKey.slice(0, 8) + "..." : "(empty)");
  throw new Error(`All endpoints failed. ${errors.join(" | ")}`);
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
  onToolCall?: (execution: ToolExecution) => void
): Promise<AgentRunResult> {
  const messages: Message[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  const toolExecutions: ToolExecution[] = [];
  let tokensUsed = 0;
  let finalText = "";
  let turns = 0;
  const MAX_TURNS = 15;

  while (turns++ < MAX_TURNS) {
    const { choice, tokensUsed: turnTokens } = await callModelEndpoint(messages, withTools, config);
    tokensUsed += turnTokens;

    const msg = choice.message;
    messages.push({ role: "assistant", content: msg.content, tool_calls: msg.tool_calls });

    if (choice.finish_reason === "stop" || !msg.tool_calls?.length) {
      finalText = msg.content ?? "";
      break;
    }

    for (const tc of msg.tool_calls) {
      let args: Record<string, string> = {};
      try {
        args = JSON.parse(tc.function.arguments) as Record<string, string>;
      } catch {
        args = {};
      }

      const result = executeTool(tc.function.name, args, workDir);

      toolExecutions.push({
        tool: tc.function.name,
        input: args,
        output: result.output.slice(0, 300),
        success: result.success,
        filePath: result.filePath,
      });

      if (onToolCall) onToolCall(toolExecutions[toolExecutions.length - 1]);

      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        name: tc.function.name,
        content: result.output,
      });
    }
  }

  if (turns > MAX_TURNS && !finalText && toolExecutions.length === 0) {
    console.warn(`  ⚠️  Agent loop hit MAX_TURNS (${MAX_TURNS}) without producing output`);
  }

  return { finalText, toolExecutions, tokensUsed };
}
