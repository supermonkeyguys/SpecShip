/**
 * spec-run.workflow.ts — SpecRunWorkflow 骨架
 *
 * Phase 1 目标：跑通最小端到端流程（单节点）。
 * Phase 2 将接入 DAG 并发调度。
 *
 * Workflow 规则（必须遵守）：
 * - 不做任何 IO、网络、文件读写、随机数、当前时间
 * - 所有副作用下沉到 Activity
 */

import { proxyActivities, defineSignal, defineQuery, setHandler } from "@temporalio/workflow";
import type { SpecRunActivities } from "../activities/spec-run.activities";

// Activity proxy — timeout 根据各步骤特性分别配置
const { planGraph, executeNode, getRunStatus } = proxyActivities<SpecRunActivities>({
  startToCloseTimeout: "10 minutes",
});

// ---- Signals（写操作）----
export const resumeRunSignal = defineSignal("resumeRun");
export const retryNodeSignal = defineSignal<[nodeId: string]>("retryNode");
export const cancelRunSignal = defineSignal<[reason: string]>("cancelRun");

// ---- Queries（读操作）----
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
  repoPath?: string;
}

export async function SpecRunWorkflow(input: SpecRunInput): Promise<RunSummary> {
  // Phase 1 内部状态：轻量 nodeId → status 映射（B2 路线）
  const nodeStatuses: Record<string, "pending" | "running" | "done" | "failed"> = {};
  let cancelled = false;
  let cancelReason = "";

  // Signal handlers
  setHandler(cancelRunSignal, (reason: string) => {
    cancelled = true;
    cancelReason = reason;
  });

  // Query handler — 实时返回当前状态
  setHandler(getRunSummaryQuery, (): RunSummary => ({
    status: cancelled ? "cancelled" : "running",
    nodeStatuses,
  }));

  // Step 1: 规划，生成节点列表
  const planResult = await planGraph({ spec: input.spec, repoPath: input.repoPath });

  if (planResult.status === "failed") {
    return { status: "failed", nodeStatuses };
  }

  // 初始化节点状态
  for (const nodeId of planResult.nodeIds) {
    nodeStatuses[nodeId] = "pending";
  }

  // Step 2: 逐节点执行（Phase 1 串行，Phase 3 改并发）
  for (const nodeId of planResult.nodeIds) {
    if (cancelled) break;

    nodeStatuses[nodeId] = "running";

    const result = await executeNode({
      nodeId,
      spec: input.spec,
      sessionId: input.sessionId,
      projectId: input.projectId,
    });

    nodeStatuses[nodeId] = result.status;

    if (result.status === "failed") {
      return {
        status: "failed",
        nodeStatuses,
        completedAt: new Date().toISOString(),
      };
    }
  }

  const finalStatus = cancelled ? "cancelled" : "done";
  return {
    status: finalStatus,
    nodeStatuses,
    completedAt: new Date().toISOString(),
  };
}
