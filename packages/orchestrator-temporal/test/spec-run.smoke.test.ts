/**
 * spec-run.smoke.test.ts — Phase 1 smoke test
 *
 * 验证：Temporal SDK 安装正确，Workflow + Activity 骨架可以跑通。
 * 使用 TestWorkflowEnvironment（内置模拟时钟，无需外部 Temporal server）。
 *
 * 这是 Temporal 迁移的最小可验证基线。
 */

import test from "node:test";
import assert from "node:assert/strict";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { SpecRunWorkflow } from "../src/workflows/spec-run.workflow";
import { specRunActivities } from "../src/activities/spec-run.activities";

const TASK_QUEUE = "test-specrun";

test("smoke: SpecRunWorkflow completes with mock activities", async () => {
  // TestWorkflowEnvironment 在内存里跑，不需要 Temporal server
  const env = await TestWorkflowEnvironment.createLocal();

  try {
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: require.resolve("../src/workflows/spec-run.workflow"),
      activities: specRunActivities,
    });

    const summary = await worker.runUntil(
      env.client.workflow.execute(SpecRunWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: `smoke-test-${Date.now()}`,
        args: [{
          spec: "Write a simple TypeScript function",
          projectId: "proj-smoke",
          sessionId: "sess-smoke",
        }],
      })
    );

    assert.equal(summary.status, "done", `expected done, got ${summary.status}`);
    assert.ok("impl-main" in summary.nodeStatuses, "expected impl-main in nodeStatuses");
    assert.equal(summary.nodeStatuses["impl-main"], "done", `expected impl-main=done`);
  } finally {
    await env.teardown();
  }
});

test("smoke: getRunSummary query returns current state", async () => {
  const env = await TestWorkflowEnvironment.createLocal();

  try {
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: require.resolve("../src/workflows/spec-run.workflow"),
      activities: specRunActivities,
    });

    const workflowId = `smoke-query-${Date.now()}`;

    const summary = await worker.runUntil(
      env.client.workflow.execute(SpecRunWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId,
        args: [{
          spec: "Write a TypeScript function",
          projectId: "proj-smoke",
          sessionId: "sess-query",
        }],
      })
    );

    // workflow 完成后状态正确
    assert.equal(summary.status, "done");
    assert.ok(summary.completedAt, "expected completedAt to be set");
    assert.ok(Object.keys(summary.nodeStatuses).length > 0, "expected nodeStatuses to be non-empty");
  } finally {
    await env.teardown();
  }
});
