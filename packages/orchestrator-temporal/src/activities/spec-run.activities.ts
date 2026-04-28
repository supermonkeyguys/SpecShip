/**
 * spec-run.activities.ts — SpecRunWorkflow Activities（真实实现）
 *
 * Phase 2: 接入 @shipyard/core 真实逻辑。
 * A1 模式：implement → verify → review 打包为单 Activity（Phase 3 再拆）。
 */

import * as path from "path";
import * as fs from "fs";
import { ApplicationFailure } from "@temporalio/activity";
import {
  buildGraph,
  executeNode as coreExecuteNode,
  runCodeReview,
  verifyNode as defaultVerifyNode,
  saveGraphCheckpoint,
  loadGraphCheckpoint,
  getSessionOutputDir,
  getSessionGraphPath,
  transitionNode,
  createGraph,
  DEFAULT_CONFIG,
  type ExecutionGraph,
  type GraphNode,
  type ShipyardConfig,
} from "@shipyard/core";

// ---- 序列化：ExecutionGraph 含 Map，需转为 plain object 跨 Activity 传递 ----

export interface SerializedNode {
  id: string;
  title: string;
  status: string;
  specFragment: string;
  dependsOn: string[];
  outputFiles: string[];
  retryCount: number;
  maxRetries: number;
  lastError?: string;
}

export interface SerializedGraph {
  id: string;
  title: string;
  originalSpec: string;
  nodes: SerializedNode[];
}

function serializeGraph(graph: ExecutionGraph): SerializedGraph {
  return {
    id: graph.id,
    title: graph.title,
    originalSpec: graph.originalSpec,
    nodes: Array.from(graph.nodes.values()).map((n) => ({
      id: n.id,
      title: n.title,
      status: n.status,
      specFragment: n.specFragment,
      dependsOn: n.dependsOn,
      outputFiles: n.outputs.files ?? [],
      retryCount: n.retryCount,
      maxRetries: n.maxRetries,
      lastError: n.lastError,
    })),
  };
}

// ---- Config factory ----

function makeConfig(workDir: string, projectId: string, sessionId: string): ShipyardConfig {
  const outputDir = path.relative(
    workDir,
    getSessionOutputDir(workDir, projectId, sessionId)
  );
  return {
    ...DEFAULT_CONFIG,
    workDir,
    projectId,
    sessionId,
    outputDir,
  };
}

// ---- Activity 输入/输出类型 ----

export interface PlanGraphInput {
  spec: string;
  workDir: string;
  projectId: string;
  sessionId: string;
  repoPath?: string;
}

export interface PlanGraphResult {
  status: "ok" | "failed";
  nodeIds: string[];
  graph: SerializedGraph | null;
  error?: string;
}

export interface ExecuteNodeActivityInput {
  nodeId: string;
  workDir: string;
  projectId: string;
  sessionId: string;
  graph: SerializedGraph;
}

export interface ExecuteNodeActivityResult {
  status: "done" | "failed";
  filesWritten: string[];
  error?: string;
  updatedGraph: SerializedGraph;
}

export interface PersistGraphInput {
  workDir: string;
  projectId: string;
  sessionId: string;
  graph: SerializedGraph;
}

export interface NotifyNodeUpdateInput {
  workDir: string;
  projectId: string;
  sessionId: string;
  nodeId: string;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  filesWritten?: string[];
  error?: string;
}

// ---- Activities ----

export const specRunActivities = {

  /**
   * planGraph — 调 core buildGraph()，返回 DAG 节点列表
   */
  async planGraph(input: PlanGraphInput): Promise<PlanGraphResult> {
    const config = makeConfig(input.workDir, input.projectId, input.sessionId);
    fs.mkdirSync(path.join(input.workDir, config.outputDir!), { recursive: true });

    let graph: ExecutionGraph | null;
    try {
      graph = await buildGraph(input.spec, config);
    } catch (e) {
      throw ApplicationFailure.create({
        message: `planGraph failed: ${(e as Error).message}`,
        nonRetryable: false,
      });
    }

    if (!graph) {
      throw ApplicationFailure.create({
        message: "Planner returned null — spec may be too ambiguous or malformed",
        nonRetryable: true,
      });
    }

    const nodeIds = Array.from(graph.nodes.keys());
    console.log(`[planGraph] ${nodeIds.length} node(s): ${nodeIds.join(", ")}`);

    const sessionGraphPath = getSessionGraphPath(input.workDir, input.projectId, input.sessionId);
    saveGraphCheckpoint(input.workDir, { ...graph, status: "running" }, sessionGraphPath);

    return { status: "ok", nodeIds, graph: serializeGraph(graph) };
  },

  /**
   * executeNode — A1 模式：implement → verify → review（单 Activity）
   */
  async executeNode(input: ExecuteNodeActivityInput): Promise<ExecuteNodeActivityResult> {
    const config = makeConfig(input.workDir, input.projectId, input.sessionId);
    const sessionGraphPath = getSessionGraphPath(input.workDir, input.projectId, input.sessionId);

    let graph: ExecutionGraph;
    try {
      graph = loadGraphCheckpoint(input.workDir, sessionGraphPath);
    } catch {
      graph = rebuildGraphFromSerialized(input.graph);
    }

    const node = graph.nodes.get(input.nodeId);
    if (!node) {
      throw ApplicationFailure.create({
        message: `Node not found: ${input.nodeId}`,
        nonRetryable: true,
      });
    }

    // 1. Implement
    let evidence: Awaited<ReturnType<typeof coreExecuteNode>>["evidence"];
    let outputFiles: string[];
    try {
      const result = await coreExecuteNode(node, graph, config);
      evidence = result.evidence;
      outputFiles = result.outputFiles;
    } catch (e) {
      throw ApplicationFailure.create({
        message: `executeNode failed: ${(e as Error).message}`,
        nonRetryable: false,
      });
    }

    // 2. Verify
    const verifyResult = await defaultVerifyNode(node.specFragment, outputFiles, input.workDir, config);

    if (!verifyResult.passed) {
      const failedOutput = verifyResult.records
        .filter((r: { passed: boolean; output: string }) => !r.passed)
        .map((r: { passed: boolean; output: string }) => r.output)
        .join("\n");

      const failedGraph = transitionNode(
        { ...graph },
        input.nodeId,
        "failed",
        { evidence: { ...evidence, verifications: verifyResult.records } }
      );
      const nodes = new Map(failedGraph.nodes);
      nodes.set(input.nodeId, { ...failedGraph.nodes.get(input.nodeId)!, lastError: failedOutput });
      saveGraphCheckpoint(input.workDir, { ...failedGraph, nodes }, sessionGraphPath);

      throw ApplicationFailure.create({
        message: `Verify failed: ${verifyResult.summary}`,
        details: [failedOutput],
        nonRetryable: false,
      });
    }

    // 3. Code Review
    const reviewResult = await runCodeReview(node, outputFiles, config);
    if (!reviewResult.passed) {
      throw ApplicationFailure.create({
        message: `Code review failed: ${reviewResult.blockingIssues}`,
        nonRetryable: false,
      });
    }

    // 成功
    const fullEvidence = { ...evidence, verifications: verifyResult.records };
    const successGraph = transitionNode(
      { ...graph },
      input.nodeId,
      "done",
      { evidence: fullEvidence }
    );
    saveGraphCheckpoint(input.workDir, successGraph, sessionGraphPath);

    console.log(`[executeNode] ${input.nodeId} done`);

    return {
      status: "done",
      filesWritten: outputFiles.map((f) => path.relative(input.workDir, f)),
      updatedGraph: serializeGraph(successGraph),
    };
  },

  /**
   * persistGraph — 写最终图状态到 checkpoint
   */
  async persistGraph(input: PersistGraphInput): Promise<void> {
    const sessionGraphPath = getSessionGraphPath(input.workDir, input.projectId, input.sessionId);
    const graph = rebuildGraphFromSerialized(input.graph);
    saveGraphCheckpoint(input.workDir, graph, sessionGraphPath);
  },

  /**
   * notifyNodeUpdate — 写节点状态投影文件，供 server 层 SSE 轮询消费
   *
   * 写到 .shipyard/sse-projection/<sessionId>/<nodeId>.json
   * server 侧用 fs.watch 或轮询读取，推 SSE 给前端。
   */
  async notifyNodeUpdate(input: NotifyNodeUpdateInput): Promise<void> {
    const projDir = path.join(
      input.workDir, ".shipyard", "sse-projection", input.sessionId
    );
    fs.mkdirSync(projDir, { recursive: true });
    const projFile = path.join(projDir, `${input.nodeId}.json`);
    const payload = {
      nodeId: input.nodeId,
      status: input.status,
      filesWritten: input.filesWritten ?? [],
      error: input.error,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(projFile, JSON.stringify(payload), "utf-8");
  },
};

// ---- 辅助：从序列化图重建 ExecutionGraph ----

function rebuildGraphFromSerialized(serialized: SerializedGraph): ExecutionGraph {
  let graph = createGraph(serialized.originalSpec);
  graph = { ...graph, id: serialized.id, title: serialized.title };

  for (const n of serialized.nodes) {
    const nodes = new Map(graph.nodes);
    nodes.set(n.id, {
      id: n.id,
      type: "implement" as const,
      title: n.title,
      specFragment: n.specFragment,
      parentId: undefined,
      dependsOn: n.dependsOn,
      inputs: { description: n.title },
      outputs: {
        description: `Write ${(n.outputFiles as string[])[0] ?? "output"}`,
        files: n.outputFiles as string[],
        verificationCriteria: [],
      },
      status: n.status as GraphNode["status"],
      retryCount: n.retryCount as number,
      maxRetries: n.maxRetries as number,
      lastError: n.lastError as string | undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    graph = { ...graph, nodes };
  }

  return graph;
}

export type SpecRunActivities = typeof specRunActivities;
