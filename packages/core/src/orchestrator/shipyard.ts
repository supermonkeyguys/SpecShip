import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { ShipyardConfig } from "../config";
import {
  ExecutionGraph, GraphNode, NodeStatus, Evidence,
  createGraph, transitionNode, getReadyNodes, buildHistory, isDependencySatisfied,
  getCheckpointNodes, replaceGraphNodes,
} from "../graph";
import { verifyNode as defaultVerifyNode } from "../verification/verify";
import { runAgent as defaultRunAgent } from "../ai/llm";
import { executeNode } from "./node-executor";
import { saveGraphCheckpoint } from "../persistence/checkpoint";
import { ExecutionLogger } from "./execution-logger";
import {
  buildCheckpointEvidence,
  pauseGraphAtCheckpoint,
  resumeGraphAfterCheckpointPause,
  writeCheckpointSummary,
} from "./checkpoint-runtime";
import { getSessionGraphPath } from "../persistence/project";
import { buildGraph, clarifySpec } from "./planner";
import { handleCompletedNodeResult } from "./post-node-handler";
import type { TaskStrategy } from "../strategies/base";
import type {
  AgentRunner,
  NodeVerifier,
  ClarificationQuestion,
  ClarificationResult,
  CheckpointHandler,
} from "./runtime-types";

export type { ExecutionGraph, GraphNode, NodeStatus };
export { buildHistory };
export { clarifySpec, buildGraph } from "./planner";
export { runCodeReview } from "./review";
export type {
  AgentRunner,
  NodeVerifier,
  ClarificationQuestion,
  ClarificationResult,
  CheckpointHandler,
} from "./runtime-types";

export { executeNode } from "./node-executor";
export { detectStrategy, getStrategy, listStrategies } from "../strategies";

// ---- 集成编译检查 ----

function collectOutputFiles(graph: ExecutionGraph, workDir: string): string[] {
  const files = new Set<string>();
  for (const node of graph.nodes.values()) {
    for (const f of node.outputs.files ?? []) {
      const abs = path.resolve(workDir, f);
      if (fs.existsSync(abs)) files.add(abs);
    }
  }
  return Array.from(files);
}

function runIntegrationCompileCheck(graph: ExecutionGraph, workDir: string): string | null {
  const files = collectOutputFiles(graph, workDir);
  if (files.length === 0) return null;

  const hasTsx = files.some((f) => f.endsWith(".tsx"));
  const jsxFlags = hasTsx ? "--jsx react --allowImportingTsExtensions" : "";

  try {
    execSync(
      `npx tsc --noEmit --target ES2022 --moduleResolution bundler --esModuleInterop --skipLibCheck ${jsxFlags} ${files.join(" ")}`,
      { cwd: workDir, encoding: "utf-8", timeout: 60_000, stdio: ["pipe", "pipe", "pipe"] }
    );
    return null;
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string };
    const output = [err.stdout, err.stderr].filter(Boolean).join("\n").trim();
    return output.slice(0, 2000);
  }
}

// ---- 主调度循环 ----

/**
 * onCheckpoint: called when a checkpoint node is reached.
 * The callback receives the checkpoint node and a `resume` function.
 * Call `resume()` to continue execution, or let the process end if you want to pause.
 * If no callback is provided, checkpoint nodes are skipped (marked done immediately).
 */
export async function run(
  spec: string,
  config: ShipyardConfig,
  initialGraph?: ExecutionGraph,
  onUpdate?: (graph: ExecutionGraph) => void,
  agentRunner: AgentRunner = defaultRunAgent,
  nodeVerifier: NodeVerifier = defaultVerifyNode,
  onCheckpoint?: CheckpointHandler,
  onClarify?: (result: ClarificationResult) => Promise<string>,
  strategy?: TaskStrategy
): Promise<ExecutionGraph> {
  const graphOrNull = initialGraph ?? await buildGraph(spec, config, agentRunner, onClarify, strategy);
  if (!graphOrNull) {
    const g = createGraph(spec);
    return { ...g, status: "failed" };
  }

  let graph: ExecutionGraph = { ...graphOrNull, status: "running" };
  const sessionGraphPath = config.sessionId && config.projectId
    ? getSessionGraphPath(config.workDir, config.projectId, config.sessionId)
    : undefined;

  // 构造 logger，session 有效时写入 execution.log.jsonl
  const logger = config.projectId && config.sessionId
    ? new ExecutionLogger(config.workDir, config.projectId, config.sessionId)
    : null;

  // 记录规划结果
  logger?.log({
    event: "plan_complete",
    title: graph.title,
    nodeCount: graph.nodes.size,
    nodes: Array.from(graph.nodes.values()).map((n) => ({
      id: n.id,
      title: n.title,
      nodeRole: n.nodeRole,
      task: n.task,
      acceptanceCriteria: n.acceptanceCriteria,
      dependsOn: n.dependsOn,
      outputFile: n.outputs.files?.[0] ?? "",
    })),
  });

  const checkpoint = () => {
    saveGraphCheckpoint(config.workDir, graph, sessionGraphPath);
    onUpdate?.(graph);
  };
  checkpoint();
  console.log(`\n[EXECUTING] Parallel agent dispatch`);

  const running = new Map<string, Promise<{
    nodeId: string; evidence: Evidence; outputFiles: string[]; fatalError?: string;
  }>>();

  while (true) {
    // 推进 pending → ready（依赖已完成）
    // dependsOn 只支持上游 step/node id
    for (const node of Array.from(graph.nodes.values())) {
      if (node.status === "pending" && node.dependsOn.every((d) => isDependencySatisfied(graph, d))) {
        const pendingNodes = new Map<string, GraphNode>(graph.nodes);
        pendingNodes.set(node.id, { ...node, status: "ready" as NodeStatus });
        graph = replaceGraphNodes(graph, pendingNodes);
        checkpoint();
      }
    }

    // 处理 checkpoint 节点（人工确认后才继续）
    for (const cpNode of getCheckpointNodes(graph)) {
      // ready → running（必须经过中间态，符合状态机规则）
      graph = transitionNode(graph, cpNode.id, "running");

      // 写摘要文件，让前端 Canvas 和文件树能展示决策点内容
      const summaryFiles = writeCheckpointSummary(cpNode, config);

      if (onCheckpoint) {
        // 暂停：告知调用方，等待 resume() 被调用后再标记为 done
        console.log(`  ⏸  [${cpNode.id}] Checkpoint: ${cpNode.title} — waiting for confirmation`);
        const cpEvidence = buildCheckpointEvidence(cpNode, summaryFiles, config.workDir);
        graph = pauseGraphAtCheckpoint(graph, cpNode.id, cpEvidence);
        checkpoint();
        await new Promise<void>((resolve) => onCheckpoint(cpNode, resolve));
        graph = resumeGraphAfterCheckpointPause(graph);
        checkpoint();
      } else {
        // 无处理器：自动通过 checkpoint
        console.log(`  ⏭  [${cpNode.id}] Checkpoint auto-approved (no handler): ${cpNode.title}`);
        checkpoint();
      }
      graph = transitionNode(graph, cpNode.id, "done");
      // 解除下游 blocked/pending 节点（checkpoint 完成后触发依赖解锁）
      for (const n of graph.nodes.values()) {
        if (n.status === "blocked" && n.dependsOn.includes(cpNode.id)) {
          graph = transitionNode(graph, n.id, "pending");
        }
        // pending 节点若所有依赖已满足，立即推进到 ready
        if (n.status === "pending" && n.dependsOn.every((d) => isDependencySatisfied(graph, d))) {
          const updatedNodes = new Map(graph.nodes);
          updatedNodes.set(n.id, { ...graph.nodes.get(n.id)!, status: "ready" as NodeStatus });
          graph = replaceGraphNodes(graph, updatedNodes);
        }
      }
      checkpoint();
    }

    // 派发就绪节点（跳过 checkpoint 类型，已在上方处理）
    for (const node of getReadyNodes(graph).filter((n) => n.type !== "checkpoint")) {
      graph = transitionNode(graph, node.id, "running");
      checkpoint();
      console.log(`  ▶ [${node.id}] ${node.title}`);
      logger?.log({ event: "node_start", nodeId: node.id, title: node.title, nodeRole: node.nodeRole, task: node.task, retryCount: node.retryCount });
      running.set(node.id, executeNode(node, graph, config, agentRunner, (nodeId, accumulatedToolCalls) => {
        // 把中途累积的 toolCalls 注入节点快照，触发 SSE 推送
        const liveNode = graph.nodes.get(nodeId);
        if (liveNode && onUpdate) {
          const patchedNodes = new Map(graph.nodes);
          patchedNodes.set(nodeId, {
            ...liveNode,
            evidence: liveNode.evidence
              ? { ...liveNode.evidence, toolCalls: accumulatedToolCalls }
              : {
                  reasoning: "",
                  promptUsed: "",
                  modelUsed: "",
                  toolCalls: accumulatedToolCalls,
                  filesWritten: [],
                  verifications: [],
                  startedAt: new Date().toISOString(),
                },
          });
          onUpdate(replaceGraphNodes(graph, patchedNodes));
        }
      }, logger ?? undefined, strategy).then((r) => ({ nodeId: node.id, ...r }))
        .catch((e: Error) => ({
          nodeId: node.id,
          evidence: {
            reasoning: "", promptUsed: "", modelUsed: config.models.implementation,
            toolCalls: [], filesWritten: [], verifications: [],
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            durationMs: 0,
          } satisfies Evidence,
          outputFiles: [] as string[],
          fatalError: e.message ?? String(e),
        })));
    }

    if (running.size === 0) break;

    // 等待最快完成的
    const result = await Promise.race(running.values());
    running.delete(result.nodeId);

    const handled = await handleCompletedNodeResult({
      graph,
      result,
      config,
      nodeVerifier,
      agentRunner,
      logger: logger ?? undefined,
      strategy,
    });
    graph = handled.graph;
    checkpoint();

    // 记录节点最终状态
    const finishedNode = graph.nodes.get(result.nodeId);
    if (finishedNode && logger) {
      const durationMs = finishedNode.evidence?.durationMs ?? 0;
      if (finishedNode.status === "done") {
        logger.log({ event: "node_done", nodeId: result.nodeId, durationMs, filesWritten: result.outputFiles.map((f) => f.replace(config.workDir + "/", "")) });
      } else if (finishedNode.status === "failed") {
        logger.log({ event: "node_failed", nodeId: result.nodeId, durationMs, reason: finishedNode.error?.message ?? "unknown", lastError: finishedNode.lastError ?? "" });
      } else if (finishedNode.status === "ready") {
        // ready 表示被安排重试
        logger.log({ event: "node_retry", nodeId: result.nodeId, retryCount: finishedNode.retryCount, maxRetries: finishedNode.maxRetries, reason: finishedNode.lastErrorKind ?? "unknown" });
      }
    }

    if (handled.logKind === "error") {
      console.error(handled.logMessage);
    } else {
      console.log(handled.logMessage);
    }
  }

  const stats = graph.stats;
  const allDone = stats.byStatus.done === stats.total;

  if (allDone) {
    const integrationError = runIntegrationCompileCheck(graph, config.workDir);
    if (integrationError) {
      console.error(`\n[INTEGRATION] Cross-file compile check failed:\n${integrationError}`);
      graph = { ...graph, status: "failed", completedAt: new Date().toISOString() };
      logger?.log({ event: "session_done", status: "failed", totalMs: Date.now(), doneCount: stats.byStatus.done, failedCount: stats.byStatus.failed });
      checkpoint();
      return graph;
    }
    console.log("[INTEGRATION] Cross-file compile check passed");
  }

  graph = { ...graph, status: allDone ? "done" : "failed", completedAt: new Date().toISOString() };
  logger?.log({ event: "session_done", status: allDone ? "done" : "failed", totalMs: Date.now(), doneCount: stats.byStatus.done, failedCount: stats.byStatus.failed });
  checkpoint();
  return graph;
}
