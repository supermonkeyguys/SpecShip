import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import { ShipyardConfig } from "../config";
import type { ExecutionLogger } from "./execution-logger";
import type { Evidence, ExecutionGraph, GraphNode } from "../graph";
import { runAgent as defaultRunAgent } from "../ai/llm";
import { makeLLMConfig } from "../ai/llm-config";
import { validateOutputPath, normalizeSandboxOutputFile } from "./output-policy";
import { routeModel } from "./model-router";
import { getNodeRolePolicy } from "./node-role-policy";
import type { AgentRunner } from "./runtime-types";
import type { TaskStrategy } from "../strategies/base";
import { typescriptLibStrategy } from "../strategies";

function cleanupNodeOutputsOnRetry(node: GraphNode, workDir: string): void {
  // 只有 fatal 错误才删文件重写；verify/review 失败时保留文件，让 LLM 能看到上次写的内容
  if (!node.lastError || node.lastErrorKind !== "fatal" || !node.outputs.files) return;
  for (const file of node.outputs.files) {
    const fullPath = path.resolve(workDir, file);
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
  }
}

function buildDependencyContext(node: GraphNode, graph: ExecutionGraph, workDir: string): string {
  return node.dependsOn
    .map((depId) => {
      const depNode = graph.nodes.get(depId);
      const depFile = depNode?.outputs.files?.[0];
      if (!depFile) return "";
      const fullPath = path.resolve(workDir, depFile);
      if (!fs.existsSync(fullPath)) return "";
      return `// From ${depFile}:\n${fs.readFileSync(fullPath, "utf-8").slice(0, 8000)}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

function readPreviousFileContent(node: GraphNode, workDir: string): string | null {
  if (!node.lastError || !node.outputs.files?.[0]) return null;
  const filePath = path.resolve(workDir, node.outputs.files[0]);
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8").slice(0, 8000) : null;
}

/**
 * 从依赖节点的实际输出文件里，提取导出符号列表。
 * 纯静态分析，不调用 LLM，零额外开销。
 */
function extractExportedSymbols(filePath: string): string[] {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, "utf-8");
  const symbols: string[] = [];
  // 匹配 export const/function/class/interface/type/enum 后面的名字
  const patterns = [
    /^export\s+(?:const|function|class|abstract\s+class|interface|type|enum)\s+(\w+)/gm,
    /^export\s+\{([^}]+)\}/gm,  // export { A, B, C }
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      if (m[1]) {
        // export { A, B as C } 需要拆开
        m[1].split(",").forEach((s) => {
          const name = s.trim().split(/\s+as\s+/)[0].trim();
          if (name) symbols.push(name);
        });
      }
    }
  }
  return [...new Set(symbols)];
}

/**
 * 执行前用依赖文件的真实导出符号增强 acceptanceCriteria。
 * 防止 Planner 猜错符号名，导致 reviewer 因"import 了不存在的符号"误判失败。
 */
export function enrichAcceptanceCriteriaFromDeps(
  node: GraphNode,
  graph: ExecutionGraph,
  workDir: string
): GraphNode {
  if (!node.dependsOn.length) return node;

  const depSymbols: string[] = [];
  for (const depId of node.dependsOn) {
    const depNode = graph.nodes.get(depId);
    const depFile = depNode?.outputs.files?.[0];
    if (!depFile) continue;
    const symbols = extractExportedSymbols(path.resolve(workDir, depFile));
    if (symbols.length) {
      depSymbols.push(`${path.basename(depFile)} exports: [${symbols.join(", ")}]`);
    }
  }

  if (!depSymbols.length) return node;

  const enriched = `${node.acceptanceCriteria}\n` +
    `Available exports from dependencies (use these exact names — do not redefine):\n` +
    depSymbols.map((s) => `  - ${s}`).join("\n");

  return { ...node, acceptanceCriteria: enriched };
}

function isTruncationError(lastError: string): boolean {
  return /truncat|incomplete|ends inside|syntactically incomplete|cut off|ends abruptly/i.test(lastError);
}

function buildImplementationPrompt(
  node: GraphNode,
  dependencyContext: string,
  previousFileContent: string | null
): string {
  const truncation = node.lastError && isTruncationError(node.lastError);
  return `
Role: ${node.nodeRole}
Task: ${node.task}
Output file: ${node.outputs.files?.[0]}
${node.skills?.length ? `Follow these conventions: ${node.skills.join(", ")}` : ""}

${dependencyContext ? `Dependency reference snippets (use exported symbols from these snippets; choose the correct relative import path for the current file):\n\`\`\`\n${dependencyContext}\n\`\`\`` : ""}
${node.lastError ? `
⚠️  PREVIOUS ATTEMPT FAILED (reason: ${node.lastErrorKind ?? "unknown"}) — you must fix these issues:
\`\`\`
${node.lastError.slice(0, 1500)}
\`\`\`
${truncation ? `
🚨 FILE TRUNCATION DETECTED: Your previous output was cut off mid-file. The file is too large to write in one pass.
You MUST split the implementation across multiple files:
1. Extract large sections (helpers, renderers, data configs) into separate files using write_file
2. Keep the main output file (${node.outputs.files?.[0]}) as a thin orchestrator that imports from those helper files
3. Each helper file should be under 80 lines
Do NOT attempt to write the entire implementation in a single file again — it will be truncated again.
` : ""}
${previousFileContent
  ? `The file you wrote last time (which has the above issues):\n\`\`\`\n${previousFileContent}\n\`\`\`\n\nAnalyze the issues carefully, then rewrite the complete corrected file.`
  : "Rewrite the file fixing all issues above."}
` : "Write the complete implementation to the output file using write_file tool."}
`.trim();
}

function normalizeToolRelativePath(filePath: string, workDir: string): string {
  const normalized = filePath.replace(/[\\/]+/g, path.sep);
  return path.resolve(workDir, normalized);
}

function ensureWritesStayWithinExpectedOutputs(
  node: GraphNode,
  toolExecutions: Array<{ tool: string; filePath?: string }>,
  config: ShipyardConfig
): void {
  const expectedPaths = node.outputs.files ?? [];
  // Planner may write outputFile as relative-to-output-dir (e.g. "styles/theme.ts") while
  // the implementer writes the full path (e.g. "output/styles/theme.ts"). Normalize both
  // through normalizeSandboxOutputFile so comparison is apples-to-apples.
  const expectedOutputFiles = new Set(
    expectedPaths
      .map((p) => normalizeSandboxOutputFile(p, config))
      .map((p) => normalizeToolRelativePath(p, config.workDir))
  );

  // Implementer MAY write adjacent test files, but behavioral testing is typically deferred to a later tester/test pass
  const allowedTestFiles = new Set(
    expectedPaths.flatMap((p) => {
      const normalized = normalizeSandboxOutputFile(p, config);
      const dotIdx = normalized.lastIndexOf(".");
      if (dotIdx <= 0) return [];
      const base = normalized.slice(0, dotIdx);
      const ext = normalized.slice(dotIdx);
      return [
        normalizeToolRelativePath(`${base}.test${ext}`, config.workDir),
        normalizeToolRelativePath(`${base}.spec${ext}`, config.workDir),
      ];
    })
  );

  const invalidWrite = toolExecutions.find((execution) => {
    if (execution.tool !== "write_file" || !execution.filePath) return false;
    const normalizedPath = normalizeToolRelativePath(execution.filePath, config.workDir);
    if (expectedOutputFiles.has(normalizedPath) || allowedTestFiles.has(normalizedPath)) {
      return validateOutputPath(normalizedPath, config) !== null;
    }
    console.error(`[output-policy] path mismatch: llm="${execution.filePath}" (norm="${normalizedPath}") expected=${JSON.stringify([...expectedOutputFiles])}`);
    return true;
  });

  if (invalidWrite?.filePath) {
    throw new Error(
      `write_file attempted unexpected path "${invalidWrite.filePath}"; expected: ${expectedPaths.join(", ") || "(none)"}`
    );
  }
}

function collectWrittenFiles(
  toolExecutions: Array<{ tool: string; filePath?: string }>,
  workDir: string
): Evidence["filesWritten"] {
  const seen = new Set<string>();
  return toolExecutions
    .filter((t) => t.tool === "write_file" && t.filePath && !t.filePath.includes("node_modules/"))
    .reverse()
    .filter((t) => {
      if (seen.has(t.filePath!)) return false;
      seen.add(t.filePath!);
      return true;
    })
    .reverse()
    .map((t) => {
      const fullPath = path.resolve(workDir, t.filePath!);
      const content = fs.existsSync(fullPath) ? fs.readFileSync(fullPath) : Buffer.from("");
      return {
        path: t.filePath!,
        operation: "create" as const,
        sizeBytes: content.length,
        checksum: crypto.createHash("sha256").update(content).digest("hex").slice(0, 16),
        timestamp: new Date().toISOString(),
      };
    });
}

function buildSuccessEvidence(
  node: GraphNode,
  prompt: string,
  modelUsed: string,
  modelRouteReason: string,
  modelRouteComplexity: Evidence["modelRouteComplexity"],
  modelRouteRisk: Evidence["modelRouteRisk"],
  toolExecutions: Array<{ tool: string; input: Record<string, unknown>; output: string; success: boolean }>,
  filesWritten: Evidence["filesWritten"],
  startedAt: string
): Evidence {
  return {
    reasoning: `Implementing: ${node.inputs.description}`,
    promptUsed: prompt.slice(0, 300),
    modelUsed,
    modelRouteReason,
    modelRouteComplexity,
    modelRouteRisk,
    toolCalls: toolExecutions.map((t) => ({
      tool: t.tool,
      input: t.input,
      output: t.output,
      success: t.success,
      timestamp: new Date().toISOString(),
    })),
    filesWritten,
    verifications: [],
    startedAt,
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - new Date(startedAt).getTime(),
  };
}

function buildFailedEvidence(
  modelUsed: string,
  modelRouteReason: string,
  modelRouteComplexity: Evidence["modelRouteComplexity"],
  modelRouteRisk: Evidence["modelRouteRisk"],
  startedAt: string
): Evidence {
  return {
    reasoning: "",
    promptUsed: "",
    modelUsed,
    modelRouteReason,
    modelRouteComplexity,
    modelRouteRisk,
    toolCalls: [],
    filesWritten: [],
    verifications: [],
    startedAt,
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - new Date(startedAt).getTime(),
  };
}

export async function executeNode(
  node: GraphNode,
  graph: ExecutionGraph,
  config: ShipyardConfig,
  agentRunner: AgentRunner = defaultRunAgent,
  onToolCallComplete?: (nodeId: string, accumulatedToolCalls: Evidence["toolCalls"]) => void,
  logger?: ExecutionLogger,
  strategy?: TaskStrategy
): Promise<{ evidence: Evidence; outputFiles: string[]; fatalError?: string }> {
  const startedAt = new Date().toISOString();

  try {
    cleanupNodeOutputsOnRetry(node, config.workDir);

    const dependencyContext = buildDependencyContext(node, graph, config.workDir);
    const previousFileContent = readPreviousFileContent(node, config.workDir);
    // 用依赖文件的真实导出符号增强 acceptanceCriteria，避免 reviewer 因符号名对不上而误判
    const enrichedNode = enrichAcceptanceCriteriaFromDeps(node, graph, config.workDir);
    const prompt = buildImplementationPrompt(enrichedNode, dependencyContext, previousFileContent);
    const activeStrategy = strategy ?? typescriptLibStrategy;
    const route = routeModel(config, { phase: "execute", nodeRole: node.nodeRole, retryCount: node.retryCount, dependsOnCount: node.dependsOn.length, dependencyContextChars: dependencyContext.length, lastErrorKind: node.lastErrorKind, executionMode: config.executionMode ?? "sandbox-output" });
    const rolePolicy = getNodeRolePolicy(node.nodeRole, activeStrategy);
    logger?.log({ event: "node_prompt", nodeId: node.id, prompt, selectedModel: route.model, routeReason: route.reason, complexity: route.complexity, risk: route.risk });
    const llmConfig = makeLLMConfig(route.model, config);

    const accumulatedToolCalls: Evidence["toolCalls"] = [];

    const { toolExecutions } = await agentRunner(
      rolePolicy.systemPrompt,
      prompt,
      config.workDir,
      llmConfig,
      true,
      (execution) => {
        if (execution.tool === "write_file" && execution.filePath) {
          console.log(`  → write: ${execution.filePath}`);
        }
        accumulatedToolCalls.push({
          tool: execution.tool,
          input: execution.input,
          output: execution.output,
          success: execution.success,
          timestamp: new Date().toISOString(),
        });
        onToolCallComplete?.(node.id, [...accumulatedToolCalls]);
      },
      rolePolicy.tools,
      { allowedCommands: activeStrategy.verify().allowedCommands }
    );

    ensureWritesStayWithinExpectedOutputs(node, toolExecutions, config);

    const filesWritten = collectWrittenFiles(toolExecutions, config.workDir);
    const outputFiles = filesWritten.map((f) => path.resolve(config.workDir, f.path));
    const evidence = buildSuccessEvidence(node, prompt, route.model, route.reason, route.complexity, route.risk, toolExecutions, filesWritten, startedAt);

    return { evidence, outputFiles };
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    console.error(`  💥 [${node.id}] executeNode fatal: ${msg}`);
    return {
      evidence: (() => { const failedRoute = routeModel(config, { phase: "execute", nodeRole: node.nodeRole, retryCount: node.retryCount, dependsOnCount: node.dependsOn.length, lastErrorKind: node.lastErrorKind, executionMode: config.executionMode ?? "sandbox-output" }); return buildFailedEvidence(failedRoute.model, failedRoute.reason, failedRoute.complexity, failedRoute.risk, startedAt); })(),
      outputFiles: [],
      fatalError: msg,
    };
  }
}
