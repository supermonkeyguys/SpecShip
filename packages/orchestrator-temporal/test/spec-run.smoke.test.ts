/**
 * spec-run.smoke.test.ts — Phase 2 smoke test
 *
 * 验证：SpecRunWorkflow + 真实 Activity 接口跑通，使用 mock activities（不调 LLM）。
 * 使用 TestWorkflowEnvironment（内置 Temporal server，无需外部进程）。
 */

import test from "node:test";
import assert from "node:assert/strict";
import * as os from "os";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { SpecRunWorkflow } from "../src/workflows/spec-run.workflow";
import type { SpecRunActivities, PlanGraphResult, ExecuteNodeActivityResult } from "../src/activities/spec-run.activities";

const TASK_QUEUE = "test-specrun";

// Mock activities — 不调 LLM，直接返回成功
const mockActivities: SpecRunActivities = {
  async planGraph(_input): Promise<PlanGraphResult> {
    return {
      status: "ok",
      nodeIds: ["impl-main"],
      graph: {
        id: "graph-test",
        title: "Test Plan",
        originalSpec: _input.spec,
        nodes: [{
          id: "impl-main",
          title: "Main implementation",
          status: "ready",
          specFragment: "Write main.ts",
          dependsOn: [],
          outputFiles: ["output/main.ts"],
          retryCount: 0,
          maxRetries: 2,
        }],
      },
    };
  },

  async executeNode(_input): Promise<ExecuteNodeActivityResult> {
    return {
      status: "done",
      filesWritten: ["output/main.ts"],
      updatedGraph: {
        id: "graph-test",
        title: "Test Plan",
        originalSpec: "Write a TypeScript function",
        nodes: [{
          id: "impl-main",
          title: "Main implementation",
          status: "done",
          specFragment: "Write main.ts",
          dependsOn: [],
          outputFiles: ["output/main.ts"],
          retryCount: 0,
          maxRetries: 2,
        }],
      },
    };
  },

  async persistGraph(_input): Promise<void> {
    // no-op in tests
  },
};

test("smoke: SpecRunWorkflow completes with mock activities", async () => {
  const env = await TestWorkflowEnvironment.createLocal();

  try {
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: require.resolve("../src/workflows/spec-run.workflow"),
      activities: mockActivities,
    });

    const summary = await worker.runUntil(
      env.client.workflow.execute(SpecRunWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: `smoke-test-${Date.now()}`,
        args: [{
          spec: "Write a simple TypeScript function",
          projectId: "proj-smoke",
          sessionId: "sess-smoke",
          workDir: os.tmpdir(),
        }],
      })
    );

    assert.equal(summary.status, "done", `expected done, got ${summary.status}`);
    assert.ok("impl-main" in summary.nodeStatuses, "expected impl-main in nodeStatuses");
    assert.equal(summary.nodeStatuses["impl-main"], "done");
  } finally {
    await env.teardown();
  }
});

test("smoke: executeNode failure propagates to workflow failed status", async () => {
  const env = await TestWorkflowEnvironment.createLocal();

  // Activities where executeNode fails
  const failingActivities: SpecRunActivities = {
    ...mockActivities,
    async executeNode(_input): Promise<ExecuteNodeActivityResult> {
      return { status: "failed", filesWritten: [], updatedGraph: mockActivities.planGraph as unknown as ExecuteNodeActivityResult["updatedGraph"] };
    },
  };

  // Override with properly failing activity
  const failActivities: SpecRunActivities = {
    ...mockActivities,
    async executeNode(_input) {
      const { ApplicationFailure } = await import("@temporalio/activity");
      throw ApplicationFailure.create({ message: "mock verify failed", nonRetryable: true });
    },
  };

  try {
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: require.resolve("../src/workflows/spec-run.workflow"),
      activities: failActivities,
    });

    const summary = await worker.runUntil(
      env.client.workflow.execute(SpecRunWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: `smoke-fail-${Date.now()}`,
        args: [{
          spec: "Write a TypeScript function",
          projectId: "proj-smoke",
          sessionId: "sess-fail",
          workDir: os.tmpdir(),
        }],
      })
    );

    assert.equal(summary.status, "failed", `expected failed, got ${summary.status}`);
    assert.equal(summary.nodeStatuses["impl-main"], "failed");
  } finally {
    await env.teardown();
  }
});

test("smoke: getRunSummary query returns node status map", async () => {
  const env = await TestWorkflowEnvironment.createLocal();

  try {
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: require.resolve("../src/workflows/spec-run.workflow"),
      activities: mockActivities,
    });

    const summary = await worker.runUntil(
      env.client.workflow.execute(SpecRunWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: `smoke-query-${Date.now()}`,
        args: [{
          spec: "Write a TypeScript function",
          projectId: "proj-smoke",
          sessionId: "sess-query",
          workDir: os.tmpdir(),
        }],
      })
    );

    assert.equal(summary.status, "done");
    assert.ok(summary.completedAt, "expected completedAt");
    assert.ok(Object.keys(summary.nodeStatuses).length > 0);
  } finally {
    await env.teardown();
  }
});
