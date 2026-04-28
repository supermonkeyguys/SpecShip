/**
 * 回归路径 3：进程中断后 resume 从断点继续
 *
 * 验证：保存一个中途中断的 checkpoint（部分节点 running/verifying），
 * prepareGraphForResume 将这些节点重置为 ready，run() 继续跑完。
 */

import test from "node:test";
import assert from "node:assert/strict";
import * as path from "path";
import {
  createGraph, addNode,
} from "../../packages/core/src/graph";
import {
  saveGraphCheckpoint, loadGraphCheckpoint, prepareGraphForResume,
} from "../../packages/core/src/checkpoint";
import { run } from "../../packages/core/src/shipyard";
import { makeMockAgentRunner, makeMockNodeVerifier, makeTestConfig } from "./helpers";

test("resume: running node is reset to ready and completes", async () => {
  const { config, cleanup } = makeTestConfig("resume");

  try {
    // 构造一个中断状态的图：有一个节点处于 running（模拟进程崩溃时的状态）
    let graph = createGraph("Write a TypeScript function");
    graph = addNode(graph, {
      id: "impl-main",
      type: "implement",
      title: "Main implementation",
      specFragment: "Write main.ts",
      dependsOn: [],
      inputs: { description: "Write output/main.ts" },
      outputs: {
        description: "Write output/main.ts",
        files: ["output/main.ts"],
        verificationCriteria: [],
      },
      status: "running",   // ← 模拟中断时的状态
      maxRetries: 2,
    });

    // 保存中断 checkpoint
    saveGraphCheckpoint(config.workDir, { ...graph, status: "running" });

    // 执行 resume 流程
    const loaded = loadGraphCheckpoint(config.workDir);
    const resumed = prepareGraphForResume(loaded);

    // 验证 prepareGraphForResume 的行为：running → ready
    const node = resumed.nodes.get("impl-main")!;
    assert.equal(node.status, "ready", `expected node reset to ready, got ${node.status}`);
    assert.equal(resumed.status, "running", "expected graph status=running after prepare");

    // 保存 resumed checkpoint，然后继续跑
    saveGraphCheckpoint(config.workDir, resumed);

    const agentRunner = makeMockAgentRunner({});
    const finalGraph = await run(resumed.originalSpec, config, resumed, undefined, agentRunner, makeMockNodeVerifier());

    assert.equal(finalGraph.status, "done", `expected graph.status=done after resume, got ${finalGraph.status}`);

    const finalNode = finalGraph.nodes.get("impl-main")!;
    assert.equal(finalNode.status, "done", `expected impl-main=done, got ${finalNode.status}`);
  } finally {
    cleanup();
  }
});

test("resume: verifying node is also reset to ready", async () => {
  const { config, cleanup } = makeTestConfig("resume-verifying");

  try {
    let graph = createGraph("Write a TypeScript function");
    graph = addNode(graph, {
      id: "impl-main",
      type: "implement",
      title: "Main implementation",
      specFragment: "Write main.ts",
      dependsOn: [],
      inputs: { description: "Write output/main.ts" },
      outputs: {
        description: "Write output/main.ts",
        files: ["output/main.ts"],
        verificationCriteria: [],
      },
      status: "verifying",  // ← 另一种中断状态
      maxRetries: 2,
    });

    const interrupted = { ...graph, status: "running" as const };
    const resumed = prepareGraphForResume(interrupted);

    const node = resumed.nodes.get("impl-main")!;
    assert.equal(node.status, "ready", `expected verifying → ready, got ${node.status}`);
  } finally {
    cleanup();
  }
});
