/**
 * helpers.ts — 回归测试共用工具
 *
 * mockAgentRunner: 模拟 LLM 调用，按 systemPrompt 类型返回不同结果。
 *   - GRAPH_PLANNER_PROMPT  → 返回包含指定 steps 的 JSON
 *   - IMPLEMENTER_PROMPT    → 用 write_file 工具写入目标文件
 *   - REVIEWER_PROMPT       → 返回 { passed: true }
 *   - SPEC_EXTRACTOR_PROMPT → 返回空数组（跳过行为验证）
 *   - CLARIFIER_PROMPT      → 返回 { needsClarification: false }
 *
 * makeTestConfig: 建立隔离的临时工作目录和最小 ShipyardConfig。
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { AgentRunner, NodeVerifier } from "../../packages/core/src/shipyard";
import type { ShipyardConfig } from "../../packages/core/src/config";

export { NodeVerifier };

// ---- 工厂：生成一个简单单节点 planner 响应 ----

export function makePlannerResponse(steps: Array<{
  id: string;
  title: string;
  outputFile: string;
  dependsOn?: string[];
  role?: string;
}>, outputDir = "output"): string {
  return JSON.stringify({
    title: "Test Plan",
    ambiguities: [],
    steps: steps.map((s) => ({
      id: s.id,
      title: s.title,
      specFragment: `Implement ${s.title}`,
      description: `Write ${s.outputFile}`,
      outputFile: `${outputDir}/${s.outputFile}`,
      dependsOn: s.dependsOn ?? [],
      role: s.role ?? "implementation",
    })),
  });
}

// ---- mockAgentRunner ----

export function makeMockAgentRunner(opts: {
  // 可选：让某个节点首次执行失败，第 N 次重试才成功（用于测试重试路径）
  failNodeIdOnAttempt?: Record<string, number>;
  // 记录每个节点被调用的次数
  attemptCounter?: Record<string, number>;
  outputDir?: string;
}): AgentRunner {
  const { failNodeIdOnAttempt = {}, attemptCounter = {}, outputDir = "output" } = opts;

  return async (systemPrompt, userPrompt, workDir, _config, _withTools, onToolCall) => {
    // Planner
    if (systemPrompt.includes("senior software architect") || systemPrompt.includes("implementation plan")) {
      // 从 userPrompt 里提取 outputDir 行
      const dirMatch = userPrompt.match(/^Output directory: (\S+)/m);
      const dir = dirMatch?.[1] ?? outputDir;
      const plan = makePlannerResponse([
        { id: "impl-main", title: "Main implementation", outputFile: "main.ts" },
      ], dir);
      return { finalText: plan, toolExecutions: [], tokensUsed: 0 };
    }

    // Reviewer
    if (systemPrompt.includes("strict code reviewer")) {
      return {
        finalText: JSON.stringify({ passed: true, blocking: [], warnings: [], summary: "ok" }),
        toolExecutions: [],
        tokensUsed: 0,
      };
    }

    // Spec extractor (verification criteria)
    if (systemPrompt.includes("test specification extractor")) {
      return { finalText: "[]", toolExecutions: [], tokensUsed: 0 };
    }

    // Clarifier
    if (systemPrompt.includes("requirements analyst")) {
      return {
        finalText: JSON.stringify({ needsClarification: false, questions: [], confidence: "high", summary: "ok" }),
        toolExecutions: [],
        tokensUsed: 0,
      };
    }

    // Implementer — 从 userPrompt 解析出目标文件路径，写入内容
    const fileMatch = userPrompt.match(/Output file: (\S+)/);
    const targetFile = fileMatch?.[1] ?? `${outputDir}/main.ts`;

    // 提取 nodeId 用于失败模拟
    const nodeIdMatch = targetFile.match(/\/([^/]+)\.ts$/);
    const nodeKey = nodeIdMatch?.[1] ?? targetFile;

    attemptCounter[nodeKey] = (attemptCounter[nodeKey] ?? 0) + 1;
    const attempt = attemptCounter[nodeKey];
    const failUntil = failNodeIdOnAttempt[nodeKey] ?? 0;

    if (attempt <= failUntil) {
      // 模拟失败：写入有 TS 编译错误的文件
      const fullPath = path.resolve(workDir, targetFile);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, `// intentional error\nconst x: number = "wrong type";\n`, "utf-8");
      onToolCall?.("write_file", targetFile);
      return {
        finalText: "",
        toolExecutions: [{ tool: "write_file", input: { path: targetFile, content: "" }, output: `Written: ${targetFile}`, success: true, filePath: targetFile }],
        tokensUsed: 0,
      };
    }

    // 成功：写入合法 TS 文件
    const content = `export function main(): string { return "ok"; }\n`;
    const fullPath = path.resolve(workDir, targetFile);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, "utf-8");
    onToolCall?.("write_file", targetFile);

    return {
      finalText: "",
      toolExecutions: [{ tool: "write_file", input: { path: targetFile, content }, output: `Written: ${targetFile} (1 lines)`, success: true, filePath: targetFile }],
      tokensUsed: 0,
    };
  };
}

// ---- mockNodeVerifier: 直接返回 passed=true，跳过真实 tsc 执行 ----

export function makeMockNodeVerifier(opts: {
  // failFirstN: 前 N 次调用返回失败，之后永远成功。默认 0（永远成功）
  failFirstN?: number;
  callCount?: { value: number };
} = {}): NodeVerifier {
  const { failFirstN = 0, callCount = { value: 0 } } = opts;

  return async (_specFragment, _outputFiles, _workDir, _config) => {
    callCount.value += 1;
    const shouldFail = callCount.value <= failFirstN;

    if (shouldFail) {
      return {
        passed: false,
        records: [{ type: "compile", passed: false, output: "mock compile error", durationMs: 0, timestamp: new Date().toISOString() }],
        summary: "mock compile error",
      };
    }

    return {
      passed: true,
      records: [{ type: "compile", passed: true, output: "mock: ok", durationMs: 0, timestamp: new Date().toISOString() }],
      summary: "mock: all checks passed",
    };
  };
}

// ---- 测试工作目录工厂 ----

export function makeTestConfig(suffix = ""): { config: ShipyardConfig; cleanup: () => void } {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `shipyard-test-${suffix}-`));

  const config: ShipyardConfig = {
    workDir,
    maxRetries: 2,
    baseURL: "http://mock",
    apiKey: "mock-key",
    models: {
      planning: "mock-model",
      implementation: "mock-model",
      review: "mock-model",
    },
  };

  const cleanup = () => {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {}
  };

  return { config, cleanup };
}
