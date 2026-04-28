/**
 * spec-run.activities.ts — SpecRunWorkflow 的 Activity 实现
 *
 * Activities 可以做任何副作用：IO、网络、文件读写。
 * Phase 1: 最小骨架，返回 mock 数据，Phase 2 接入真实 core 逻辑。
 */

export interface PlanGraphInput {
  spec: string;
  repoPath?: string;
}

export interface PlanGraphResult {
  status: "ok" | "failed";
  nodeIds: string[];        // 执行顺序（Phase 1 串行，Phase 3 改 DAG）
  error?: string;
}

export interface ExecuteNodeInput {
  nodeId: string;
  spec: string;
  sessionId: string;
  projectId: string;
}

export interface ExecuteNodeResult {
  status: "done" | "failed";
  filesWritten: string[];
  error?: string;
}

export interface GetRunStatusInput {
  workflowId: string;
}

export interface GetRunStatusResult {
  isRunning: boolean;
}

// Activity 实现（Phase 1 骨架，Phase 2 替换为真实逻辑）
export const specRunActivities = {
  async planGraph(input: PlanGraphInput): Promise<PlanGraphResult> {
    // Phase 2: 接入 packages/core 的 buildGraph()
    // 目前返回单节点 mock，用于跑通端到端流程
    console.log(`[planGraph] spec="${input.spec.slice(0, 50)}"`);
    return {
      status: "ok",
      nodeIds: ["impl-main"],
    };
  },

  async executeNode(input: ExecuteNodeInput): Promise<ExecuteNodeResult> {
    // Phase 2: 接入 packages/core 的 executeNode() + verifyNode() + runCodeReview()
    // 目前返回 mock 成功，用于跑通端到端流程
    console.log(`[executeNode] nodeId=${input.nodeId}`);
    return {
      status: "done",
      filesWritten: [],
    };
  },

  async getRunStatus(input: GetRunStatusInput): Promise<GetRunStatusResult> {
    return { isRunning: false };
  },
};

// Activity 类型，供 Workflow proxyActivities 使用
export type SpecRunActivities = typeof specRunActivities;
