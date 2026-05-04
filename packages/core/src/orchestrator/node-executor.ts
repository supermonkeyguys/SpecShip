import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import { ShipyardConfig } from "../config";
import type { ExecutionLogger } from "./execution-logger";
import type { Evidence, ExecutionGraph, GraphNode } from "../graph";
import { runAgent as defaultRunAgent } from "../ai/llm";
import { makeLLMConfig } from "../ai/llm-config";
import { validateOutputPath } from "./output-policy";
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
      return `// From ${depFile}:\n${fs.readFileSync(fullPath, "utf-8").slice(0, 2000)}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

function readPreviousFileContent(node: GraphNode, workDir: string): string | null {
  if (!node.lastError || !node.outputs.files?.[0]) return null;
  const filePath = path.resolve(workDir, node.outputs.files[0]);
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8").slice(0, 3000) : null;
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

function buildImplementationPrompt(
  node: GraphNode,
  dependencyContext: string,
  previousFileContent: string | null
): string {
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
${previousFileContent
  ? `The file you wrote last time (which has the above issues):\n\`\`\`\n${previousFileContent}\n\`\`\`\n\nAnalyze the issues carefully, then rewrite the complete corrected file.`
  : "Rewrite the file fixing all issues above."}
` : "Write the complete implementation to the output file using write_file tool."}
`.trim();
}

function normalizeToolRelativePath(filePath: string): string {
  return path.posix.normalize(filePath.replace(/\\/g, "/"));
}

function ensureWritesStayWithinExpectedOutputs(
  node: GraphNode,
  toolExecutions: Array<{ tool: string; filePath?: string }>,
  config: ShipyardConfig
): void {
  const expectedPaths = node.outputs.files ?? [];
  const expectedOutputFiles = new Set(expectedPaths.map(normalizeToolRelativePath));
  const invalidWrite = toolExecutions.find((execution) => {
    if (execution.tool !== "write_file" || !execution.filePath) return false;
    const normalizedPath = normalizeToolRelativePath(execution.filePath);
    return !expectedOutputFiles.has(normalizedPath) || validateOutputPath(normalizedPath, config) !== null;
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
  return toolExecutions
    .filter((t) => t.tool === "write_file" && t.filePath)
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
  toolExecutions: Array<{ tool: string; input: Record<string, unknown>; output: string; success: boolean }>,
  filesWritten: Evidence["filesWritten"],
  startedAt: string
): Evidence {
  return {
    reasoning: `Implementing: ${node.inputs.description}`,
    promptUsed: prompt.slice(0, 300),
    modelUsed,
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

function buildFailedEvidence(modelUsed: string, startedAt: string): Evidence {
  return {
    reasoning: "",
    promptUsed: "",
    modelUsed,
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
    logger?.log({ event: "node_prompt", nodeId: node.id, prompt });
    const llmConfig = makeLLMConfig(config.models.implementation, config);

    const activeStrategy = strategy ?? typescriptLibStrategy;
    const accumulatedToolCalls: Evidence["toolCalls"] = [];
    const { toolExecutions } = await agentRunner(
      activeStrategy.implementerPrompt,
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
      activeStrategy.tools()
    );

    ensureWritesStayWithinExpectedOutputs(node, toolExecutions, config);

    const filesWritten = collectWrittenFiles(toolExecutions, config.workDir);
    const outputFiles = filesWritten.map((f) => path.resolve(config.workDir, f.path));
    const evidence = buildSuccessEvidence(node, prompt, config.models.implementation, toolExecutions, filesWritten, startedAt);

    return { evidence, outputFiles };
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    console.error(`  💥 [${node.id}] executeNode fatal: ${msg}`);
    return {
      evidence: buildFailedEvidence(config.models.implementation, startedAt),
      outputFiles: [],
      fatalError: msg,
    };
  }
}
