import type { ShipyardConfig } from "../config";
import { transitionNode, replaceGraphNodes } from "../graph";
import type { Evidence, ExecutionGraph } from "../graph";
import { runCodeReview } from "./review";
import { enrichAcceptanceCriteriaFromDeps } from "./node-executor";
import type { AgentRunner, NodeVerifier } from "./runtime-types";
import type { ExecutionLogger } from "./execution-logger";

export interface NodeExecutionResult {
  nodeId: string;
  evidence: Evidence;
  outputFiles: string[];
  fatalError?: string;
}

export interface PostNodeHandlingContext {
  graph: ExecutionGraph;
  result: NodeExecutionResult;
  config: ShipyardConfig;
  nodeVerifier: NodeVerifier;
  agentRunner: AgentRunner;
  logger?: ExecutionLogger;
}

export interface PostNodeHandlingResult {
  graph: ExecutionGraph;
  logMessage: string;
  logKind: "info" | "warn" | "error";
}

async function handleFatalExecutionError({ graph, result }: PostNodeHandlingContext): Promise<PostNodeHandlingResult> {
  const { nodeId, evidence, fatalError } = result;
  const currentNode = graph.nodes.get(nodeId)!;

  if (currentNode.retryCount < currentNode.maxRetries) {
    const failedGraph = transitionNode(graph, nodeId, "failed", {
      evidence,
      error: { message: String(fatalError), category: "unknown", recoverable: true },
    });
    const nodes = new Map(failedGraph.nodes);
    nodes.set(nodeId, {
      ...failedGraph.nodes.get(nodeId)!,
      status: "ready",
      retryCount: currentNode.retryCount + 1,
      lastError: String(fatalError),
      lastErrorKind: "fatal" as const,
    });

    return {
      graph: replaceGraphNodes(failedGraph, nodes),
      logKind: "error",
      logMessage: `  💥 [${nodeId}] Fatal, retrying ${currentNode.retryCount + 1}/${currentNode.maxRetries}: ${fatalError}`,
    };
  }

  return {
    graph: transitionNode(graph, nodeId, "failed", {
      evidence,
      error: { message: String(fatalError), category: "unknown", recoverable: true },
    }),
    logKind: "error",
    logMessage: `  💥 [${nodeId}] Fatal: ${fatalError}`,
  };
}

async function handleVerifiedSuccess(
  graph: ExecutionGraph,
  nodeId: string,
  fullEvidence: Evidence,
  outputFiles: string[],
  config: ShipyardConfig,
  agentRunner: AgentRunner,
  logger?: ExecutionLogger
): Promise<PostNodeHandlingResult> {
  const node = graph.nodes.get(nodeId)!;
  // 用依赖文件真实导出符号增强 acceptanceCriteria，使 reviewer 有准确的验收基准
  const enrichedNode = enrichAcceptanceCriteriaFromDeps(node, graph, config.workDir);
  const reviewResult = await runCodeReview(enrichedNode, outputFiles, config, agentRunner, logger);

  if (!reviewResult.passed) {
    const reviewMessage = `Code review failed: ${reviewResult.blockingIssues || "unknown blocking issues"}`;
    if (node.retryCount < node.maxRetries) {
      const nodes = new Map(graph.nodes);
      nodes.set(nodeId, {
        ...graph.nodes.get(nodeId)!,
        status: "ready",
        retryCount: node.retryCount + 1,
        lastError: reviewMessage,
        lastErrorKind: "review" as const,
      });
      return {
        graph: replaceGraphNodes(graph, nodes),
        logKind: "info",
        logMessage: `  🔍 [${nodeId}] Review failed, retrying...`,
      };
    }

    return {
      graph: transitionNode(graph, nodeId, "failed", {
        evidence: fullEvidence,
        error: { message: reviewMessage, category: "logic", recoverable: false },
      }),
      logKind: "info",
      logMessage: `  ❌ [${nodeId}] ${reviewMessage}`,
    };
  }

  let updatedGraph = transitionNode(graph, nodeId, "done", { evidence: fullEvidence });
  for (const downstreamNode of updatedGraph.nodes.values()) {
    if (downstreamNode.status === "blocked" && downstreamNode.dependsOn.includes(nodeId)) {
      updatedGraph = transitionNode(updatedGraph, downstreamNode.id, "pending");
    }
  }

  return {
    graph: updatedGraph,
    logKind: "info",
    logMessage: `  ✅ [${nodeId}] done`,
  };
}

async function handleVerificationFailure(
  graph: ExecutionGraph,
  nodeId: string,
  fullEvidence: Evidence,
  verifySummary: string,
  verifyRecords: Evidence["verifications"]
): Promise<PostNodeHandlingResult> {
  const currentNode = graph.nodes.get(nodeId)!;

  if (currentNode.retryCount < currentNode.maxRetries) {
    const failedVerifications = verifyRecords
      .filter((r) => !r.passed)
      .map((r) => r.output)
      .join("\n");

    const failedGraph = transitionNode(graph, nodeId, "failed", { evidence: fullEvidence });
    const nodes = new Map(failedGraph.nodes);
    nodes.set(nodeId, {
      ...failedGraph.nodes.get(nodeId)!,
      status: "ready",
      retryCount: currentNode.retryCount + 1,
      lastError: failedVerifications,
      lastErrorKind: "verify" as const,
    });

    return {
      graph: replaceGraphNodes(failedGraph, nodes),
      logKind: "info",
      logMessage: `  ↻ [${nodeId}] Retry ${currentNode.retryCount + 1}/${currentNode.maxRetries}`,
    };
  }

  return {
    graph: transitionNode(graph, nodeId, "failed", {
      evidence: fullEvidence,
      error: { message: verifySummary, category: "compile", recoverable: false },
    }),
    logKind: "info",
    logMessage: `  ❌ [${nodeId}] ${verifySummary}`,
  };
}

export async function handleCompletedNodeResult(context: PostNodeHandlingContext): Promise<PostNodeHandlingResult> {
  const { graph, result, config, nodeVerifier, agentRunner, logger } = context;
  const { nodeId, evidence, outputFiles, fatalError } = result;

  if (fatalError) {
    return handleFatalExecutionError(context);
  }

  let verifyingGraph = transitionNode(graph, nodeId, "verifying");
  const node = verifyingGraph.nodes.get(nodeId)!;
  const verifyResult = await nodeVerifier(node.specFragment, outputFiles, config.workDir, config, node.nodeRole);
  const fullEvidence: Evidence = { ...evidence, verifications: verifyResult.records };
  logger?.log({ event: "verify_result", nodeId, passed: verifyResult.passed, errors: verifyResult.records.filter(r => !r.passed).map(r => r.output).join("\n").slice(0, 1000) });

  if (verifyResult.passed) {
    return handleVerifiedSuccess(verifyingGraph, nodeId, fullEvidence, outputFiles, config, agentRunner, logger);
  }

  return handleVerificationFailure(
    verifyingGraph,
    nodeId,
    fullEvidence,
    verifyResult.summary,
    verifyResult.records,
  );
}
