import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import { ShipyardConfig } from "./config";
import { GRAPH_PLANNER_PROMPT, IMPLEMENTER_PROMPT, REVIEWER_PROMPT } from "./prompts";
import { extractRepoContext } from "./repo";
import {
  ExecutionGraph, GraphNode, NodeStatus, Evidence,
  createGraph, addNode, transitionNode, getReadyNodes, buildHistory, isDependencySatisfied,
} from "./graph";
import { verifyNode as defaultVerifyNode, NodeVerificationResult } from "./verify";
import { runAgent as defaultRunAgent, AgentRunResult, LLMClientConfig } from "./llm";
import { saveGraphCheckpoint } from "./checkpoint";

export type { ExecutionGraph, GraphNode, NodeStatus };
export { buildHistory };

// AgentRunner 是 LLM 调用的抽象接口。
// 生产代码使用 defaultRunAgent；测试和 Temporal Activity 可注入替代实现。
export type AgentRunner = (
  systemPrompt: string,
  userPrompt: string,
  workDir: string,
  config: LLMClientConfig,
  withTools?: boolean,
  onToolCall?: (name: string, filePath?: string) => void
) => Promise<AgentRunResult>;

// NodeVerifier 是验证步骤的抽象接口。
// 生产代码使用 defaultVerifyNode；测试可注入直接返回 passed=true 的实现。
export type NodeVerifier = (
  specFragment: string,
  outputFiles: string[],
  workDir: string,
  config: ShipyardConfig
) => Promise<NodeVerificationResult>;

// ---- 从 ShipyardConfig 构建 LLMClientConfig ----

function makeLLMConfig(model: string, config: ShipyardConfig): LLMClientConfig {
  return {
    baseURL: config.baseURL,
    apiKey:  config.apiKey,
    model,
  };
}

// ---- Phase 1: 规划 → 构建执行图 ----

async function buildGraph(spec: string, config: ShipyardConfig, agentRunner: AgentRunner = defaultRunAgent): Promise<ExecutionGraph | null> {
  console.log("\n[PLANNING] Building execution graph...");

  // outputDir：session 模式下用独立目录，否则用默认 output/
  const outputDir = config.outputDir ?? "output";
  fs.mkdirSync(path.join(config.workDir, outputDir), { recursive: true });

  // 如果有仓库路径，提取上下文注入 spec
  let enrichedSpec = spec;
  if (config.repoPath) {
    try {
      const repoCtx = extractRepoContext(config.repoPath);
      enrichedSpec = `${repoCtx.summary}\n\n=== Task ===\n${spec}`;
      console.log(`  📂 Repo context loaded: ${config.repoPath}`);
    } catch (e) {
      console.warn(`  ⚠️  Failed to load repo context: ${(e as Error).message}`);
    }
  }

  // 告诉 Planner 文件应该写在哪个目录
  const plannerInput = `Output directory: ${outputDir}\n\n${enrichedSpec}`;

  const llmConfig = makeLLMConfig(config.models.planning, config);
  const { finalText } = await agentRunner(GRAPH_PLANNER_PROMPT, plannerInput, config.workDir, llmConfig, false);

  let planData: {
    title: string;
    ambiguities: string[];
    steps: Array<{
      id: string; title: string; specFragment: string;
      description: string; outputFile: string; dependsOn: string[]; role: string;
    }>;
  };

  try {
    const match = finalText.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON in response");
    planData = JSON.parse(match[0]);
  } catch (e) {
    console.error(`  ✗ Failed to parse plan: ${(e as Error).message}`);
    console.error(`  Raw: ${finalText.slice(0, 300)}`);
    return null;
  }

  // 文件唯一性校验
  const files = planData.steps.map((s) => s.outputFile);
  const dupes = files.filter((f, i) => files.indexOf(f) !== i);
  if (dupes.length) {
    console.error(`  ✗ Duplicate files: ${dupes.join(", ")}`);
    return null;
  }

  // dependsOn 合法性校验
  const stepIds = new Set(planData.steps.map((s) => s.id));
  for (const step of planData.steps) {
    const invalidDeps = step.dependsOn.filter((d) => !stepIds.has(d));
    if (invalidDeps.length) {
      console.error(`  ✗ Step "${step.id}" has unknown dependsOn: ${invalidDeps.join(", ")}`);
      return null;
    }
  }

  // 构建图
  let graph = createGraph(spec);
  graph = { ...graph, title: planData.title };

  if (planData.ambiguities?.length) {
    console.log("  ℹ️  Assumptions:");
    planData.ambiguities.forEach((a) => console.log(`     • ${a}`));
  }

  for (const step of planData.steps) {
    graph = addNode(graph, {
      id: step.id,
      type: "implement",
      title: step.title,
      specFragment: step.specFragment,
      dependsOn: step.dependsOn,
      inputs: { description: step.description },
      outputs: {
        description: `Write ${step.outputFile}`,
        files: [step.outputFile],
        verificationCriteria: [],
      },
      status: step.dependsOn.length === 0 ? "ready" : "pending",
      maxRetries: config.maxRetries,
    });
  }

  // 打印图结构
  const nodes = Array.from(graph.nodes.values());
  console.log(`  → ${nodes.length} node(s)`);
  nodes.forEach((n) => {
    const deps = n.dependsOn.length ? ` ← ${n.dependsOn.join(", ")}` : " (start)";
    console.log(`     [${n.id}] ${n.title}${deps}`);
  });

  return graph;
}

// ---- Phase 2: 执行单个节点 ----

async function executeNode(
  node: GraphNode,
  graph: ExecutionGraph,
  config: ShipyardConfig,
  agentRunner: AgentRunner = defaultRunAgent
): Promise<{ evidence: Evidence; outputFiles: string[] }> {
  const startedAt = new Date().toISOString();

  // 重试时清理旧文件，避免脏状态影响验证
  if (node.lastError && node.outputs.files) {
    for (const f of node.outputs.files) {
      const fullPath = path.resolve(config.workDir, f);
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    }
  }

  // 依赖文件内容注入
  const depContext = node.dependsOn
    .map((depId) => {
      const depNode = graph.nodes.get(depId);
      const depFile = depNode?.outputs.files?.[0];
      if (!depFile) return "";
      const fullPath = path.resolve(config.workDir, depFile);
      if (!fs.existsSync(fullPath)) return "";
      return `// From ${depFile}:\n${fs.readFileSync(fullPath, "utf-8").slice(0, 2000)}`;
    })
    .filter(Boolean)
    .join("\n\n");

  // 读取上次生成的文件内容（如果是重试）
  const prevFileContent = node.lastError && node.outputs.files?.[0]
    ? (() => {
        const p = path.resolve(config.workDir, node.outputs.files![0]);
        return fs.existsSync(p) ? fs.readFileSync(p, "utf-8").slice(0, 3000) : null;
      })()
    : null;

  const prompt = `
Spec context: ${node.specFragment}

Task: ${node.inputs.description}
Output file: ${node.outputs.files?.[0]}

${depContext ? `Dependencies (import from these):\n\`\`\`\n${depContext}\n\`\`\`` : ""}
${node.lastError ? `
⚠️  PREVIOUS ATTEMPT FAILED — you must fix these errors:
\`\`\`
${node.lastError.slice(0, 1500)}
\`\`\`
${prevFileContent ? `Previous code that failed:\n\`\`\`\n${prevFileContent}\n\`\`\`\n\nFix the errors above and rewrite the complete corrected file.` : "Rewrite the file fixing all errors above."}
` : "Write the complete implementation to the output file using write_file tool."}
`.trim();

  const llmConfig = makeLLMConfig(config.models.implementation, config);

  const { toolExecutions, tokensUsed } = await agentRunner(
    IMPLEMENTER_PROMPT,
    prompt,
    config.workDir,
    llmConfig,
    true,
    (toolName, filePath) => {
      if (toolName === "write_file" && filePath) {
        console.log(`  → write: ${filePath}`);
      }
    }
  );

  // 收集写入的文件
  const filesWritten = toolExecutions
    .filter((t) => t.tool === "write_file" && t.filePath)
    .map((t) => {
      const fullPath = path.resolve(config.workDir, t.filePath!);
      const content = fs.existsSync(fullPath) ? fs.readFileSync(fullPath) : Buffer.from("");
      return {
        path: t.filePath!,
        operation: "create" as const,
        sizeBytes: content.length,
        checksum: crypto.createHash("sha256").update(content).digest("hex").slice(0, 16),
        timestamp: new Date().toISOString(),
      };
    });

  const outputFiles = filesWritten.map((f) => path.resolve(config.workDir, f.path));

  const evidence: Evidence = {
    reasoning: `Implementing: ${node.inputs.description}`,
    promptUsed: prompt.slice(0, 300),
    modelUsed: config.models.implementation,
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

  return { evidence, outputFiles };
}

// ---- Code Review ----

async function runCodeReview(
  node: GraphNode,
  outputFiles: string[],
  config: ShipyardConfig,
  agentRunner: AgentRunner = defaultRunAgent
): Promise<{ passed: boolean; blockingIssues: string }> {
  const fileContents = outputFiles
    .filter((f) => fs.existsSync(f))
    .map((f) => `// ${path.relative(config.workDir, f)}\n${fs.readFileSync(f, "utf-8").slice(0, 2000)}`)
    .join("\n\n");

  if (!fileContents) return { passed: true, blockingIssues: "" };

  try {
    const { finalText } = await agentRunner(
      REVIEWER_PROMPT,
      `Spec: ${node.specFragment}\n\nCode:\n${fileContents}`,
      config.workDir,
      makeLLMConfig(config.models.review ?? config.models.planning, config),
      false
    );

    const match = finalText.match(/\{[\s\S]*\}/);
    if (!match) return { passed: true, blockingIssues: "" };

    const result = JSON.parse(match[0]) as { passed: boolean; blocking?: string[]; warnings?: string[]; summary?: string };

    if (result.blocking?.length) {
      console.log(`  🔍 Review blocking: ${result.blocking.join("; ")}`);
    }
    if (result.warnings?.length) {
      console.log(`  ⚠️  Review warnings: ${result.warnings.join("; ")}`);
    }

    return {
      passed: result.passed !== false,
      blockingIssues: (result.blocking ?? []).join("; "),
    };
  } catch {
    return { passed: true, blockingIssues: "" }; // review 出错不阻塞
  }
}

// ---- 主调度循环 ----

export async function run(
  spec: string,
  config: ShipyardConfig,
  initialGraph?: ExecutionGraph,
  onUpdate?: (graph: ExecutionGraph) => void,
  agentRunner: AgentRunner = defaultRunAgent,
  nodeVerifier: NodeVerifier = defaultVerifyNode
): Promise<ExecutionGraph> {
  const graphOrNull = initialGraph ?? await buildGraph(spec, config, agentRunner);
  if (!graphOrNull) {
    const g = createGraph(spec);
    return { ...g, status: "failed" };
  }

  let graph: ExecutionGraph = { ...graphOrNull, status: "running" };
  const sessionGraphPath = config.sessionId && config.projectId
    ? require("./project").getSessionGraphPath(config.workDir, config.projectId, config.sessionId)
    : undefined;

  const checkpoint = () => {
    saveGraphCheckpoint(config.workDir, graph, sessionGraphPath);
    onUpdate?.(graph);
  };
  checkpoint();
  console.log(`\n[EXECUTING] Parallel agent dispatch`);

  const running = new Map<string, Promise<{
    nodeId: string; evidence: Evidence; outputFiles: string[];
  }>>();

  while (true) {
    // 推进 pending → ready（依赖已完成）
    // dependsOn 可能是节点 id 或文件路径，两种都支持
    for (const node of Array.from(graph.nodes.values())) {
      if (node.status === "pending" && node.dependsOn.every((d) => isDependencySatisfied(graph, d))) {
        const pendingNodes = new Map<string, GraphNode>(graph.nodes);
        pendingNodes.set(node.id, { ...node, status: "ready" as NodeStatus });
        graph = { ...graph, nodes: pendingNodes };
        checkpoint();
      }
    }

    // 派发就绪节点
    for (const node of getReadyNodes(graph)) {
      graph = transitionNode(graph, node.id, "running");
      checkpoint();
      console.log(`  ▶ [${node.id}] ${node.title}`);
      running.set(node.id, executeNode(node, graph, config, agentRunner).then((r) => ({ nodeId: node.id, ...r })));
    }

    if (running.size === 0) break;

    // 等待最快完成的
    const { nodeId, evidence, outputFiles } = await Promise.race(running.values());
    running.delete(nodeId);

    graph = transitionNode(graph, nodeId, "verifying");
    checkpoint();

    const node = graph.nodes.get(nodeId)!;
    const verifyResult = await nodeVerifier(node.specFragment, outputFiles, config.workDir, config);

    const fullEvidence: Evidence = { ...evidence, verifications: verifyResult.records };

    if (verifyResult.passed) {
      // Review：verify 通过后做一次代码 review
      const reviewResult = await runCodeReview(node, outputFiles, config, agentRunner);
      if (!reviewResult.passed && node.retryCount < node.maxRetries) {
        // review 失败 → 重试，将 blocking 原因注入 lastError 供下次执行使用
        const nodes = new Map(graph.nodes);
        nodes.set(nodeId, {
          ...graph.nodes.get(nodeId)!,
          status: "ready",
          retryCount: node.retryCount + 1,
          lastError: `Code review failed: ${reviewResult.blockingIssues}`,
        });
        graph = { ...graph, nodes };
        checkpoint();
        console.log(`  🔍 [${nodeId}] Review failed, retrying...`);
        continue;
      }

      graph = transitionNode(graph, nodeId, "done", { evidence: fullEvidence });
      console.log(`  ✅ [${nodeId}] ${verifyResult.summary}`);
      // 节点成功后，通过状态机解除下游 blocked 节点
      for (const n of graph.nodes.values()) {
        if (n.status === "blocked" && n.dependsOn.includes(nodeId)) {
          graph = transitionNode(graph, n.id, "pending");
        }
      }
      checkpoint();
    } else {
      const currentNode = graph.nodes.get(nodeId)!;
      if (currentNode.retryCount < currentNode.maxRetries) {
        // 收集详细错误信息，注入下次重试的 prompt
        const failedVerifications = verifyResult.records
          .filter((r) => !r.passed)
          .map((r) => r.output)
          .join("\n");

        graph = transitionNode(graph, nodeId, "failed", { evidence: fullEvidence });
        const nodes = new Map(graph.nodes);
        nodes.set(nodeId, {
          ...graph.nodes.get(nodeId)!,
          status: "ready",
          retryCount: currentNode.retryCount + 1,
          lastError: failedVerifications,  // 传给下次执行
        });
        graph = { ...graph, nodes };
        checkpoint();
        console.log(`  ↻ [${nodeId}] Retry ${currentNode.retryCount + 1}/${currentNode.maxRetries}`);
      } else {
        graph = transitionNode(graph, nodeId, "failed", {
          evidence: fullEvidence,
          error: { message: verifyResult.summary, category: "compile", recoverable: false },
        });
        checkpoint();
        console.log(`  ❌ [${nodeId}] ${verifyResult.summary}`);
      }
    }
  }

  const stats = graph.stats;
  const allDone = stats.byStatus.done === stats.total;
  graph = { ...graph, status: allDone ? "done" : "failed", completedAt: new Date().toISOString() };
  checkpoint();
  return graph;
}
