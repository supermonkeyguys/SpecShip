/**
 * 回归路径：checkpoint 节点暂停与恢复
 *
 * 验证：
 * 1. 包含 checkpoint 节点的 DAG，onCheckpoint 被调用后暂停，resume() 后继续执行
 * 2. 无 onCheckpoint 处理器时，checkpoint 节点自动通过
 * 3. checkpoint 节点写出摘要 .md 文件
 */

import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { run, type CheckpointHandler } from "../../packages/core/src/orchestrator/shipyard";
import { makeMockAgentRunner, makeMockNodeVerifier, makeTestConfig, makePlannerResponse } from "./helpers";
import type { AgentRunner } from "../../packages/core/src/orchestrator/shipyard";

/** Planner mock: checkpoint-confirm → impl-main (depends on checkpoint) */
function makeCheckpointPlanRunner(outputDir: string): AgentRunner {
  const base = makeMockAgentRunner({});
  return async (systemPrompt, userPrompt, workDir, config, withTools, onToolCall) => {
    if (systemPrompt.includes("senior software architect") || systemPrompt.includes("implementation plan")) {
      const plan = makePlannerResponse(
        [
          { id: "checkpoint-confirm", title: "Confirm schema design", outputFile: "checkpoint-confirm-review.md", dependsOn: [], role: "checkpoint" },
          { id: "impl-main", title: "Main implementation", outputFile: "main.ts", dependsOn: ["checkpoint-confirm"] },
        ],
        outputDir
      );
      return { finalText: plan, toolExecutions: [], tokensUsed: 0 };
    }
    return base(systemPrompt, userPrompt, workDir, config, withTools, onToolCall);
  };
}

test("checkpoint: onCheckpoint called, execution pauses then resumes", async () => {
  const { config, cleanup } = makeTestConfig("checkpoint-pause");
  const checkpointCalled: string[] = [];
  let resumeFn: (() => void) | null = null;

  const onCheckpoint: CheckpointHandler = (node, resume) => {
    checkpointCalled.push(node.id);
    resumeFn = resume;
  };

  try {
    const runPromise = run(
      "Write a TypeScript module",
      config,
      undefined,
      undefined,
      makeCheckpointPlanRunner(config.outputDir ?? "output"),
      makeMockNodeVerifier(),
      onCheckpoint,
    );

    // 等待 onCheckpoint 被调用（最多 2s）
    const deadline = Date.now() + 2000;
    while (!resumeFn && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }

    assert.ok(resumeFn !== null, "onCheckpoint should have been called before impl-main starts");
    assert.deepEqual(checkpointCalled, ["checkpoint-confirm"]);

    // 触发恢复
    resumeFn!();
    const graph = await runPromise;

    assert.equal(graph.status, "done");

    const cp = graph.nodes.get("checkpoint-confirm");
    assert.equal(cp?.status, "done", "checkpoint node done after resume");
    assert.equal(cp?.retryCount, 0, "checkpoint node never retried");

    const impl = graph.nodes.get("impl-main");
    assert.equal(impl?.status, "done", "impl-main done after checkpoint unblocked it");
  } finally {
    cleanup();
  }
});

test("checkpoint: auto-approved when no onCheckpoint provided", async () => {
  const { config, cleanup } = makeTestConfig("checkpoint-auto");

  try {
    const graph = await run(
      "Write a TypeScript module",
      config,
      undefined,
      undefined,
      makeCheckpointPlanRunner(config.outputDir ?? "output"),
      makeMockNodeVerifier(),
    );

    assert.equal(graph.status, "done");
    assert.equal(graph.nodes.get("checkpoint-confirm")?.status, "done");
    assert.equal(graph.nodes.get("impl-main")?.status, "done");
  } finally {
    cleanup();
  }
});

test("checkpoint: graph status becomes paused before resume", async () => {
  const { config, cleanup } = makeTestConfig("checkpoint-paused-status");
  let resumeFn: (() => void) | null = null;
  const seenStatuses: string[] = [];

  const onCheckpoint: CheckpointHandler = (_node, resume) => {
    resumeFn = resume;
  };

  try {
    const runPromise = run(
      "Write a TypeScript module",
      config,
      undefined,
      (updatedGraph) => {
        seenStatuses.push(updatedGraph.status);
      },
      makeCheckpointPlanRunner(config.outputDir ?? "output"),
      makeMockNodeVerifier(),
      onCheckpoint,
    );

    const deadline = Date.now() + 2000;
    while (!resumeFn && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }

    assert.ok(resumeFn !== null, "checkpoint should have fired");
    assert.ok(seenStatuses.includes("paused"), `expected statuses to include paused, got: ${seenStatuses.join(", ")}`);

    resumeFn!();
    const graph = await runPromise;
    assert.equal(graph.status, "done");
  } finally {
    cleanup();
  }
});

test("checkpoint: summary .md file written before pause", async () => {
  const { config, cleanup } = makeTestConfig("checkpoint-file");
  let resumeFn: (() => void) | null = null;

  const onCheckpoint: CheckpointHandler = (_node, resume) => { resumeFn = resume; };

  try {
    const runPromise = run(
      "Write a TypeScript module",
      config,
      undefined,
      undefined,
      makeCheckpointPlanRunner(config.outputDir ?? "output"),
      makeMockNodeVerifier(),
      onCheckpoint,
    );

    const deadline = Date.now() + 2000;
    while (!resumeFn && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.ok(resumeFn !== null, "checkpoint should have fired");

    // 摘要文件必须在 resume 之前就已写出
    const summaryPath = path.join(config.workDir, config.outputDir ?? "output", "checkpoint-confirm-review.md");
    assert.ok(fs.existsSync(summaryPath), `summary file should exist before resume: ${summaryPath}`);
    const content = fs.readFileSync(summaryPath, "utf-8");
    assert.ok(content.includes("Checkpoint"), "summary should contain Checkpoint heading");

    resumeFn!();
    await runPromise;
  } finally {
    cleanup();
  }
});
