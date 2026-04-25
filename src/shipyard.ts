import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import { ShipyardConfig } from "./config";
import { PLANNER_PROMPT, IMPLEMENTER_PROMPT } from "./prompts";
import {
  ExecutionGraph, GraphNode, NodeStatus, Evidence,
  createGraph, addNode, transitionNode, getReadyNodes, buildHistory,
} from "./graph";
import { verifyNode } from "./verify";
import { runAgent, LLMClientConfig } from "./llm";

export type { ExecutionGraph, GraphNode, NodeStatus };
export { buildHistory };

// ---- 从 ShipyardConfig 构建 LLMClientConfig ----

function makeLLMConfig(model: string, config: ShipyardConfig): LLMClientConfig {
  return {
    baseURL: config.baseURL,
    apiKey:  config.apiKey,
    model,
  };
}

// ---- Phase 1: 规划 → 构建执行图 ----

const GRAPH_PLANNER_PROMPT = `
You are a software architect. Analyze a spec and produce a parallel-safe implementation plan.

Output ONLY a JSON object, no markdown:
{
  "title": "short title",
  "ambiguities": ["assumption made"],
  "steps": [
    {
      "id": "impl-types",
      "title": "Define types",
      "specFragment": "the exact spec text this addresses",
      "description": "what to implement",
      "outputFile": "output/types.ts",
      "dependsOn": [],
      "role": "types"
    }
  ]
}

Rules:
- id: unique, kebab-case (e.g. "impl-auth", "test-login")
- Each step produces ONE .ts file with unique path (always TypeScript, never .js)
- dependsOn: only when you need to IMPORT from that file
- types/interfaces → dependsOn: []
- implementation → depends on types file only
- tests → depends on the file being tested
- Max 6 steps
- role: types | implementation | test | util
`.trim();

async function buildGraph(spec: string, config: ShipyardConfig): Promise<ExecutionGraph | null> {
  console.log("\n[PLANNING] Building execution graph...");

  const llmConfig = makeLLMConfig(config.models.planning, config);
  const { finalText } = await runAgent(GRAPH_PLANNER_PROMPT, spec, config.workDir, llmConfig, false);

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
  config: ShipyardConfig
): Promise<{ evidence: Evidence; outputFiles: string[] }> {
  const startedAt = new Date().toISOString();

  // 依赖文件内容注入
  const depContext = node.dependsOn
    .map((depId) => {
      const depNode = graph.nodes.get(depId);
      const depFile = depNode?.outputs.files?.[0];
      if (!depFile) return "";
      const fullPath = path.resolve(config.workDir, depFile);
      if (!fs.existsSync(fullPath)) return "";
      return `// From ${depFile}:\n${fs.readFileSync(fullPath, "utf-8").slice(0, 600)}`;
    })
    .filter(Boolean)
    .join("\n\n");

  const prompt = `
Spec context: ${node.specFragment}

Task: ${node.inputs.description}
Output file: ${node.outputs.files?.[0]}

${depContext ? `Dependencies (import from these):\n\`\`\`typescript\n${depContext}\n\`\`\`` : ""}

Write the complete implementation to the output file using write_file tool.
`.trim();

  const llmConfig = makeLLMConfig(config.models.implementation, config);

  const { toolExecutions, tokensUsed } = await runAgent(
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

// ---- 主调度循环 ----

export async function run(spec: string, config: ShipyardConfig): Promise<ExecutionGraph> {
  const graphOrNull = await buildGraph(spec, config);
  if (!graphOrNull) {
    const g = createGraph(spec);
    return { ...g, status: "failed" };
  }

  let graph: ExecutionGraph = { ...graphOrNull, status: "running" };
  console.log(`\n[EXECUTING] Parallel agent dispatch`);

  const running = new Map<string, Promise<{
    nodeId: string; evidence: Evidence; outputFiles: string[];
  }>>();

  while (true) {
    // 推进 pending → ready（依赖已完成）
    // dependsOn 可能是节点 id 或文件路径，两种都支持
    const doneNodeIds = new Set(
      Array.from(graph.nodes.values()).filter((n) => n.status === "done").map((n) => n.id)
    );
    const doneOutputFiles = new Set(
      Array.from(graph.nodes.values())
        .filter((n) => n.status === "done")
        .flatMap((n) => n.outputs.files ?? [])
    );

    for (const node of Array.from(graph.nodes.values())) {
      if (node.status === "pending" && node.dependsOn.every(
        (d) => doneNodeIds.has(d) || doneOutputFiles.has(d)
      )) {
        const pendingNodes = new Map<string, GraphNode>(graph.nodes);
        pendingNodes.set(node.id, { ...node, status: "ready" as NodeStatus });
        graph = { ...graph, nodes: pendingNodes };
      }
    }

    // 派发就绪节点
    for (const node of getReadyNodes(graph)) {
      graph = transitionNode(graph, node.id, "running");
      console.log(`  ▶ [${node.id}] ${node.title}`);
      running.set(node.id, executeNode(node, graph, config).then((r) => ({ nodeId: node.id, ...r })));
    }

    if (running.size === 0) break;

    // 等待最快完成的
    const { nodeId, evidence, outputFiles } = await Promise.race(running.values());
    running.delete(nodeId);

    graph = transitionNode(graph, nodeId, "verifying");

    const node = graph.nodes.get(nodeId)!;
    const verifyResult = await verifyNode(node.specFragment, outputFiles, config.workDir, config);

    const fullEvidence: Evidence = { ...evidence, verifications: verifyResult.records };

    if (verifyResult.passed) {
      graph = transitionNode(graph, nodeId, "done", { evidence: fullEvidence });
      console.log(`  ✅ [${nodeId}] ${verifyResult.summary}`);
      // 节点成功后，解除因之前失败而被 blocked 的下游节点
      const unblocked = new Map<string, GraphNode>(graph.nodes);
      for (const n of unblocked.values()) {
        if (n.status === "blocked" && n.dependsOn.includes(nodeId)) {
          unblocked.set(n.id, { ...n, status: "pending" as NodeStatus });
        }
      }
      graph = { ...graph, nodes: unblocked };
    } else {
      const currentNode = graph.nodes.get(nodeId)!;
      if (currentNode.retryCount < currentNode.maxRetries) {
        graph = transitionNode(graph, nodeId, "failed", { evidence: fullEvidence });
        const nodes = new Map(graph.nodes);
        nodes.set(nodeId, { ...graph.nodes.get(nodeId)!, status: "ready", retryCount: currentNode.retryCount + 1 });
        graph = { ...graph, nodes };
        console.log(`  ↻ [${nodeId}] Retry ${currentNode.retryCount + 1}/${currentNode.maxRetries}`);
      } else {
        graph = transitionNode(graph, nodeId, "failed", {
          evidence: fullEvidence,
          error: { message: verifyResult.summary, category: "compile", recoverable: false },
        });
        console.log(`  ❌ [${nodeId}] ${verifyResult.summary}`);
      }
    }
  }

  const stats = graph.stats;
  const allDone = stats.byStatus.done === stats.total;
  graph = { ...graph, status: allDone ? "done" : "failed", completedAt: new Date().toISOString() };
  return graph;
}
