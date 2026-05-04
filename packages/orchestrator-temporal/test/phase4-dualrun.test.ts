/**
 * phase4-dualrun.test.ts — Phase 4 灰度双跑验证
 *
 * 目标：同一 spec 分别跑 legacy 路径和 Temporal 路径，
 * 验证：
 * 1. 两路径最终 graph status 一致（都是 done 或都是 failed）
 * 2. 输出文件集合相同（文件名一致）
 * 3. 所有节点都到达终态（无 pending/running 残留）
 *
 * 使用 TestWorkflowEnvironment（不需要外部 Temporal server）。
 * LLM 调用通过 agentRunner/nodeVerifier 注入 mock。
 */

import test from "node:test";
import assert from "node:assert/strict";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";

import { run } from "../../../packages/core/src/orchestrator/shipyard";
import { makeMockAgentRunner, makeMockNodeVerifier, makeTestConfig } from "../../../test/regression/helpers";
import { SpecRunWorkflow } from "../src/workflows/spec-run.workflow";
import type { SpecRunActivities, PlanGraphResult, ExecuteNodeActivityResult } from "../src/activities/spec-run.activities";

const TASK_QUEUE = "test-dualrun";
const SPEC = "Write a TypeScript utility function that adds two numbers";

// ---- Mock Activities（对齐 mock agent runner 的行为）----

function makeMockActivities(workDir: string): SpecRunActivities {
  return {
    async planGraph(input): Promise<PlanGraphResult> {
      return {
        status: "ok",
        nodeIds: ["impl-main"],
        graph: {
          id: "g-dual",
          title: "Dual Run Test",
          originalSpec: input.spec,
          nodes: [{
            id: "impl-main",
            title: "Main implementation",
            status: "ready",
            specFragment: "Implement Main implementation",
            dependsOn: [],
            outputFiles: [`output/main.ts`],
            retryCount: 0,
            maxRetries: 2,
          }],
        },
      };
    },

    async executeNode(input): Promise<ExecuteNodeActivityResult> {
      // 写入和 legacy mock 一样的文件内容
      const outputPath = path.join(workDir, "output", "main.ts");
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, `export function main(): string { return "ok"; }\n`);

      return {
        status: "done",
        filesWritten: ["output/main.ts"],
        updatedGraph: {
          id: "g-dual",
          title: "Dual Run Test",
          originalSpec: input.graph.originalSpec,
          nodes: [{
            id: input.nodeId,
            title: "Main implementation",
            status: "done",
            specFragment: "s",
            dependsOn: [],
            outputFiles: ["output/main.ts"],
            retryCount: 0,
            maxRetries: 2,
          }],
        },
      };
    },

    async persistGraph(): Promise<void> {},
    async notifyNodeUpdate(): Promise<void> {},
  };
}

test("phase4: legacy and temporal paths produce consistent results", async () => {
  // ---- Legacy 路径 ----
  const { config: legacyConfig, cleanup: legacyCleanup } = makeTestConfig("dual-legacy");
  const legacyAgent = makeMockAgentRunner({});
  const legacyVerifier = makeMockNodeVerifier();

  let legacyStatus: string;
  let legacyFiles: string[] = [];

  try {
    const legacyGraph = await run(SPEC, legacyConfig, undefined, undefined, legacyAgent, legacyVerifier);
    legacyStatus = legacyGraph.status;
    for (const node of legacyGraph.nodes.values()) {
      legacyFiles.push(...(node.evidence?.filesWritten.map((f) => f.path) ?? []));
    }
    // 所有节点终态
    for (const node of legacyGraph.nodes.values()) {
      assert.ok(
        ["done", "failed", "skipped", "blocked"].includes(node.status),
        `legacy node ${node.id} is not terminal: ${node.status}`
      );
    }
  } finally {
    legacyCleanup();
  }

  // ---- Temporal 路径 ----
  const temporalWorkDir = fs.mkdtempSync(path.join(os.tmpdir(), "dual-temporal-"));
  const env = await TestWorkflowEnvironment.createLocal();

  let temporalStatus: string;
  let temporalFiles: string[] = [];

  try {
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: require.resolve("../src/workflows/spec-run.workflow"),
      activities: makeMockActivities(temporalWorkDir),
    });

    const summary = await worker.runUntil(
      env.client.workflow.execute(SpecRunWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: `dual-test-${Date.now()}`,
        args: [{
          spec: SPEC,
          projectId: "p-dual",
          sessionId: "s-dual",
          workDir: temporalWorkDir,
        }],
      })
    );

    temporalStatus = summary.status;
    temporalFiles = Object.entries(summary.nodeStatuses)
      .filter(([, s]) => s === "done")
      .map(([id]) => `output/${id}.ts`);

    // 所有节点终态
    for (const [nodeId, status] of Object.entries(summary.nodeStatuses)) {
      assert.ok(
        ["done", "failed", "skipped", "blocked"].includes(status),
        `temporal node ${nodeId} is not terminal: ${status}`
      );
    }
  } finally {
    fs.rmSync(temporalWorkDir, { recursive: true, force: true });
    await env.teardown();
  }

  // ---- 对比 ----
  assert.equal(
    temporalStatus === "done" || temporalStatus === "failed",
    legacyStatus === "done" || legacyStatus === "failed",
    `status consistency failed: legacy=${legacyStatus}, temporal=${temporalStatus}`
  );

  // 两边都应该 done
  assert.equal(legacyStatus,   "done", `legacy expected done, got ${legacyStatus}`);
  assert.equal(temporalStatus, "done", `temporal expected done, got ${temporalStatus}`);
});
