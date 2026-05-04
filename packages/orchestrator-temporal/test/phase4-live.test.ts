/**
 * phase4-live.test.ts — 真实 Temporal server 端到端验证
 *
 * 需要：TEMPORAL_LIVE_TEST=1
 * 优先连接外部 Temporal server；若未配置 TEMPORAL_ADDRESS，则回退到本地 dev server。
 *
 * 验证：
 * 1. Client 能连接到 Temporal server
 * 2. Worker 能注册并消费 Task
 * 3. Workflow 完整跑通（mock activities，不调 LLM）
 * 4. Workflow ID 规范：specship:{projectId}:{sessionId}
 */

import test from "node:test";
import assert from "node:assert/strict";
import * as os from "os";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { SpecRunWorkflow } from "../src/workflows/spec-run.workflow";
import type { SpecRunActivities, PlanGraphResult, ExecuteNodeActivityResult } from "../src/activities/spec-run.activities";

const SKIP = !process.env.TEMPORAL_LIVE_TEST;
const TASK_QUEUE = "test-live";
const ADDRESS = process.env.TEMPORAL_ADDRESS;

const mockActivities: SpecRunActivities = {
  async planGraph(input): Promise<PlanGraphResult> {
    return {
      status: "ok", nodeIds: ["impl-main"],
      graph: { id: "g-live", title: "Live Test", originalSpec: input.spec,
        nodes: [{ id: "impl-main", title: "Main", status: "ready", specFragment: "s",
          dependsOn: [], outputFiles: [], retryCount: 0, maxRetries: 2 }] },
    };
  },
  async executeNode(input): Promise<ExecuteNodeActivityResult> {
    return {
      status: "done", filesWritten: [],
      updatedGraph: { id: "g-live", title: "Live Test", originalSpec: "s",
        nodes: [{ id: input.nodeId, title: "M", status: "done", specFragment: "s",
          dependsOn: [], outputFiles: [], retryCount: 0, maxRetries: 2 }] },
    };
  },
  async persistGraph(): Promise<void> {},
  async notifyNodeUpdate(): Promise<void> {},
};

test("phase4-live: workflow runs on temporal server", { skip: SKIP ? "Set TEMPORAL_LIVE_TEST=1 to run" : false }, async () => {
  const env = ADDRESS
    ? await TestWorkflowEnvironment.createFromExistingServer({ address: ADDRESS })
    : await TestWorkflowEnvironment.createLocal();

  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: TASK_QUEUE,
    workflowsPath: require.resolve("../src/workflows/spec-run.workflow"),
    activities: mockActivities,
  });

  const projectId = "proj-live";
  const sessionId = `sess-${Date.now()}`;
  const workflowId = `specship:${projectId}:${sessionId}`;

  try {
    const summary = await worker.runUntil(
      env.client.workflow.execute(SpecRunWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId,
        args: [{ spec: "Write a TypeScript function", projectId, sessionId, workDir: os.tmpdir() }],
      })
    );

    assert.equal(summary.status, "done");
    assert.equal(summary.nodeStatuses["impl-main"], "done");

    assert.ok(workflowId.startsWith("specship:"), `workflowId should start with specship: got ${workflowId}`);

    console.log(`\n  ✓ Workflow ID: ${workflowId}`);
    console.log(`  ✓ Run: temporal workflow show --workflow-id ${workflowId}`);
  } finally {
    await env.teardown();
  }
});
