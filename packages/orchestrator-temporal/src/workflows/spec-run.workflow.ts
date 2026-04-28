/**
 * spec-run.workflow.ts — SpecRunWorkflow（Phase 3：并发 DAG 调度）
 *
 * 调度逻辑：
 * 1. planGraph → 得到 DAG（nodeIds + dependsOn）
 * 2. 主循环：找出所有 ready 节点（依赖已 done）→ 并发派发
 * 3. Promise.race 等最快完成的 → 更新状态 → 解锁下游
 * 4. 直到所有节点 done/failed/skipped 或收到 cancel
 *
 * Signals:
 *   retryNode(nodeId)  — 把 failed 节点重置为 pending，重新调度
 *   skipNode(nodeId)   — 把 pending/failed 节点标为 skipped，解锁下游
 *   cancelRun(reason)  — 停止派发新节点，等当前节点完成后退出
 *
 * Queries:
 *   getRunSummary — 返回当前 nodeStatuses 快照
 *
 * Workflow 规则：不做任何 IO / 网络 / 文件操作
 */

import {
  proxyActivities,
  defineSignal,
  defineQuery,
  setHandler,
  condition,
} from "@temporalio/workflow";
import type {
  SpecRunActivities,
  SerializedGraph,
  SerializedNode,
} from "../activities/spec-run.activities";

const activities = proxyActivities<SpecRunActivities>({
  startToCloseTimeout: "10 minutes",
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 2,
    initialInterval: "5s",
  },
});

// ---- Signals ----
export const retryNodeSignal   = defineSignal<[nodeId: string]>("retryNode");
export const skipNodeSignal    = defineSignal<[nodeId: string]>("skipNode");
export const cancelRunSignal   = defineSignal<[reason: string]>("cancelRun");

// ---- Queries ----
export const getRunSummaryQuery = defineQuery<RunSummary>("getRunSummary");

// ---- Types ----

type NodeStatus = "pending" | "running" | "done" | "failed" | "skipped" | "blocked";

export interface RunSummary {
  status: "running" | "done" | "failed" | "cancelled";
  nodeStatuses: Record<string, NodeStatus>;
  completedAt?: string;
}

export interface SpecRunInput {
  spec: string;
  projectId: string;
  sessionId: string;
  workDir: string;
  repoPath?: string;
}

// ---- Helpers ----

/** 检查节点的所有依赖是否都已 done 或 skipped */
function isDepsReady(
  nodeId: string,
  dependsOnMap: Record<string, string[]>,
  statuses: Record<string, NodeStatus>
): boolean {
  return (dependsOnMap[nodeId] ?? []).every(
    (dep) => statuses[dep] === "done" || statuses[dep] === "skipped"
  );
}

/** 检查是否有依赖 failed（不可恢复） */
function hasDepsBlocked(
  nodeId: string,
  dependsOnMap: Record<string, string[]>,
  statuses: Record<string, NodeStatus>
): boolean {
  return (dependsOnMap[nodeId] ?? []).some(
    (dep) => statuses[dep] === "failed" || statuses[dep] === "blocked"
  );
}

// ---- Workflow ----

export async function SpecRunWorkflow(input: SpecRunInput): Promise<RunSummary> {
  const nodeStatuses: Record<string, NodeStatus> = {};
  const dependsOnMap: Record<string, string[]> = {};
  // skipPending: 记录被 signal 跳过但当前已 running 的节点，等 Activity 返回时忽略其结果
  const skipPending = new Set<string>();
  let cancelled = false;
  let currentGraph: SerializedGraph | null = null;

  // ---- Signal handlers ----

  setHandler(cancelRunSignal, (reason: string) => {
    console.log(`[workflow] cancel: ${reason}`);
    cancelled = true;
  });

  setHandler(retryNodeSignal, (nodeId: string) => {
    if (nodeStatuses[nodeId] === "failed") {
      nodeStatuses[nodeId] = "pending";
      console.log(`[workflow] retryNode: ${nodeId} → pending`);
    }
  });

  setHandler(skipNodeSignal, (nodeId: string) => {
    const s = nodeStatuses[nodeId];
    if (s === "pending" || s === "failed" || s === "blocked") {
      nodeStatuses[nodeId] = "skipped";
      console.log(`[workflow] skipNode: ${nodeId} → skipped`);
    } else if (s === "running") {
      // 节点已派发但结果未到，标记为待跳过；Activity 返回时忽略结果
      skipPending.add(nodeId);
      console.log(`[workflow] skipNode: ${nodeId} queued for skip`);
    }
  });

  // ---- Query handler ----

  setHandler(getRunSummaryQuery, (): RunSummary => ({
    status: cancelled ? "cancelled" : "running",
    nodeStatuses: { ...nodeStatuses },
  }));

  // ---- Step 1: Plan ----

  const planResult = await activities.planGraph({
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

  // 初始化状态和依赖图
  for (const node of planResult.graph.nodes) {
    nodeStatuses[node.id] = "pending";
    dependsOnMap[node.id] = node.dependsOn;
  }

  // ---- Step 2: 并发 DAG 调度循环 ----

  // in-flight: nodeId → Promise<{ nodeId, success, updatedGraph?, error? }>
  type NodeResult = { nodeId: string; success: boolean; updatedGraph?: SerializedGraph; error?: string };
  const running = new Map<string, Promise<NodeResult>>();

  const allTerminal = () =>
    Object.values(nodeStatuses).every(
      (s) => s === "done" || s === "failed" || s === "skipped" || s === "blocked"
    );

  while (!allTerminal()) {
    if (cancelled) break;

    // 推进 blocked 状态：依赖 failed/blocked 的节点标为 blocked
    for (const [nodeId, status] of Object.entries(nodeStatuses)) {
      if (status === "pending" && hasDepsBlocked(nodeId, dependsOnMap, nodeStatuses)) {
        nodeStatuses[nodeId] = "blocked";
        await activities.notifyNodeUpdate({
          workDir: input.workDir, projectId: input.projectId,
          sessionId: input.sessionId, nodeId, status: "failed",
        });
      }
    }

    // 派发 ready 节点（依赖全 done/skipped，且未在运行中）
    for (const [nodeId, status] of Object.entries(nodeStatuses)) {
      if (
        status === "pending" &&
        !running.has(nodeId) &&
        isDepsReady(nodeId, dependsOnMap, nodeStatuses)
      ) {
        nodeStatuses[nodeId] = "running";
        await activities.notifyNodeUpdate({
          workDir: input.workDir, projectId: input.projectId,
          sessionId: input.sessionId, nodeId, status: "running",
        });

        const nodePromise: Promise<NodeResult> = activities
          .executeNode({
            nodeId,
            workDir: input.workDir,
            projectId: input.projectId,
            sessionId: input.sessionId,
            graph: currentGraph!,
          })
          .then((result) => ({
            nodeId,
            success: result.status === "done",
            updatedGraph: result.updatedGraph,
          }))
          .catch((e: Error) => ({
            nodeId,
            success: false,
            error: e.message,
          }));

        running.set(nodeId, nodePromise);
      }
    }

    if (running.size === 0) {
      // 没有可派发的节点，也没有 in-flight 的节点
      // 检查是否所有 pending 节点都被 blocked 了
      const pendingNodes = Object.entries(nodeStatuses).filter(([, s]) => s === "pending");
      if (pendingNodes.length > 0) {
        // 等 Signal（retryNode / skipNode）来解锁
        await condition(() =>
          pendingNodes.some(([id]) => nodeStatuses[id] !== "pending") || cancelled
        );
      }
      continue;
    }

    // 等最快完成的节点
    const result = await Promise.race(running.values());
    running.delete(result.nodeId);

    if (skipPending.has(result.nodeId)) {
      // Signal 要求跳过：忽略 Activity 结果，标为 skipped
      skipPending.delete(result.nodeId);
      nodeStatuses[result.nodeId] = "skipped";
    } else if (result.success && result.updatedGraph) {
      nodeStatuses[result.nodeId] = "done";
      currentGraph = result.updatedGraph;

      // 解除因依赖失败而 blocked 的下游节点（如果上游重试成功）
      for (const [nodeId, status] of Object.entries(nodeStatuses)) {
        if (
          status === "blocked" &&
          (dependsOnMap[nodeId] ?? []).includes(result.nodeId)
        ) {
          nodeStatuses[nodeId] = "pending";
        }
      }
    } else {
      nodeStatuses[result.nodeId] = "failed";
    }

    await activities.notifyNodeUpdate({
      workDir: input.workDir,
      projectId: input.projectId,
      sessionId: input.sessionId,
      nodeId: result.nodeId,
      status: nodeStatuses[result.nodeId] as "done" | "failed",
      error: result.error,
    });
  }

  // ---- 结算 ----

  if (currentGraph) {
    await activities.persistGraph({
      workDir: input.workDir,
      projectId: input.projectId,
      sessionId: input.sessionId,
      graph: currentGraph,
    });
  }

  const hasFailed = Object.values(nodeStatuses).some((s) => s === "failed");
  const finalStatus = cancelled ? "cancelled" : hasFailed ? "failed" : "done";

  return {
    status: finalStatus,
    nodeStatuses,
    completedAt: new Date().toISOString(),
  };
}
