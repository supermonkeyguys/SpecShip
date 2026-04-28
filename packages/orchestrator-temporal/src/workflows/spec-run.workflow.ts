/**
 * spec-run.workflow.ts — SpecRunWorkflow
 *
 * Phase 2: 接入真实 Activities，串行执行 DAG 节点。
 * Phase 3: 改为并发调度（ready 节点并行执行）。
 *
 * Workflow 规则（必须遵守）：
 * - 不做任何 IO、网络、文件读写、随机数
 * - 所有副作用在 Activity 里执行
 * - 不使用 Date.now() / Math.random() — 用 workflow.now() 代替
 */

import { proxyActivities, defineSignal, defineQuery, setHandler, ApplicationFailure } from "@temporalio/workflow";
import type { SpecRunActivities, SerializedGraph } from "../activities/spec-run.activities";

const { planGraph, executeNode, persistGraph } = proxyActivities<SpecRunActivities>({
  startToCloseTimeout: "10 minutes",
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 2,
  },
});

// ---- Signals ----
export const resumeRunSignal = defineSignal("resumeRun");
export const retryNodeSignal = defineSignal<[nodeId: string]>("retryNode");
export const cancelRunSignal = defineSignal<[reason: string]>("cancelRun");

// ---- Queries ----
export const getRunSummaryQuery = defineQuery<RunSummary>("getRunSummary");

export interface RunSummary {
  status: "running" | "done" | "failed" | "cancelled";
  nodeStatuses: Record<string, "pending" | "running" | "done" | "failed">;
  completedAt?: string;
}

export interface SpecRunInput {
  spec: string;
  projectId: string;
  sessionId: string;
  workDir: string;
  repoPath?: string;
}

export async function SpecRunWorkflow(input: SpecRunInput): Promise<RunSummary> {
  const nodeStatuses: Record<string, "pending" | "running" | "done" | "failed"> = {};
  let cancelled = false;
  let currentGraph: SerializedGraph | null = null;

  setHandler(cancelRunSignal, (reason: string) => {
    console.log(`[workflow] cancel requested: ${reason}`);
    cancelled = true;
  });

  setHandler(getRunSummaryQuery, (): RunSummary => ({
    status: cancelled ? "cancelled" : "running",
    nodeStatuses: { ...nodeStatuses },
    completedAt: undefined,
  }));

  // Step 1: 规划
  const planResult = await planGraph({
    spec: input.spec,
    workDir: input.workDir,
    projectId: input.projectId,
    sessionId: input.sessionId,
    repoPath: input.repoPath,
  });

  if (planResult.status === "failed" || !planResult.graph) {
    return { status: "failed", nodeStatuses };
  }

  currentGraph = planResult.graph;

  for (const nodeId of planResult.nodeIds) {
    nodeStatuses[nodeId] = "pending";
  }

  // Step 2: 串行执行各节点（Phase 3 改并发）
  for (const nodeId of planResult.nodeIds) {
    if (cancelled) break;

    nodeStatuses[nodeId] = "running";

    try {
      const result: Awaited<ReturnType<typeof executeNode>> = await executeNode({
        nodeId,
        workDir: input.workDir,
        projectId: input.projectId,
        sessionId: input.sessionId,
        graph: currentGraph!,
      });

      nodeStatuses[nodeId] = result.status;
      currentGraph = result.updatedGraph;

      if (result.status === "failed") {
        await persistGraph({
          workDir: input.workDir,
          projectId: input.projectId,
          sessionId: input.sessionId,
          graph: currentGraph!,
        });
        return { status: "failed", nodeStatuses };
      }
    } catch (e) {
      // Activity exhausted retries
      nodeStatuses[nodeId] = "failed";
      return { status: "failed", nodeStatuses };
    }
  }

  const finalStatus = cancelled ? "cancelled" : "done";

  if (currentGraph) {
    await persistGraph({
      workDir: input.workDir,
      projectId: input.projectId,
      sessionId: input.sessionId,
      graph: currentGraph,
    });
  }

  return {
    status: finalStatus,
    nodeStatuses,
    completedAt: new Date().toISOString(),
  };
}
