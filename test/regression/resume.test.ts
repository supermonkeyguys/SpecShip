/**
 * 回归路径 3：进程中断后 resume 从断点继续
 *
 * 验证：保存一个中途中断的 checkpoint（部分节点 running/verifying），
 * prepareGraphForResume 将这些节点重置为 ready，run() 继续跑完。
 */

import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import {
  createGraph, addNode,
} from "../../packages/core/src/graph";
import {
  saveGraphCheckpoint, loadGraphCheckpoint, prepareGraphForResume,
} from "../../packages/core/src/persistence/checkpoint";
import { run, type CheckpointHandler } from "../../packages/core/src/orchestrator/shipyard";
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
      nodeRole: "implementer",
      task: "implement",
      acceptanceCriteria: "implemented correctly",
      skills: [],
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
      nodeRole: "implementer",
      task: "implement",
      acceptanceCriteria: "implemented correctly",
      skills: [],
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

test("resume: paused checkpoint graph auto-approves resumed checkpoint and completes", async () => {
  const { config, cleanup } = makeTestConfig("resume-paused-checkpoint");
  let resumeFn: (() => void) | null = null;

  const onCheckpoint: CheckpointHandler = (_node, resume) => {
    resumeFn = resume;
  };

  try {
    const planner = makeMockAgentRunner({});
    const base = planner;
    const checkpointPlanner = async (systemPrompt: string, userPrompt: string, workDir: string, llmConfig: { model: string; baseURL: string; apiKey: string }, withTools?: boolean, onToolCall?: Parameters<typeof base>[5]) => {
      if (systemPrompt.includes("senior software architect") || systemPrompt.includes("implementation plan")) {
        return {
          finalText: JSON.stringify({
            title: "Checkpoint Resume Plan",
            ambiguities: [],
            steps: [
              {
                id: "checkpoint-confirm",
                title: "Confirm design",
                specFragment: "Confirm design",
      nodeRole: "implementer",
      task: "implement",
      acceptanceCriteria: "implemented correctly",
      skills: [],
                description: "Human approval required",
                outputFile: `${config.outputDir ?? "output"}/checkpoint-confirm-review.md`,
                dependsOn: [],
                role: "checkpoint",
              },
              {
                id: "impl-main",
                title: "Main implementation",
                specFragment: "Implement main",
      nodeRole: "implementer",
      task: "implement",
      acceptanceCriteria: "implemented correctly",
      skills: [],
                description: `Write ${config.outputDir ?? "output"}/main.ts`,
                outputFile: `${config.outputDir ?? "output"}/main.ts`,
                dependsOn: ["checkpoint-confirm"],
                role: "implementation",
              },
            ],
          }),
          toolExecutions: [],
          tokensUsed: 0,
        };
      }
      return base(systemPrompt, userPrompt, workDir, llmConfig, withTools, onToolCall);
    };

    const runPromise = run(
      "Write a TypeScript module",
      config,
      undefined,
      undefined,
      checkpointPlanner,
      makeMockNodeVerifier(),
      onCheckpoint,
    );

    const deadline = Date.now() + 2000;
    while (!resumeFn && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.ok(resumeFn, "checkpoint should pause before resume snapshot");

    const pausedGraph = loadGraphCheckpoint(config.workDir);
    assert.equal(pausedGraph.status, "paused");
    assert.equal(pausedGraph.nodes.get("checkpoint-confirm")?.status, "running");
    assert.ok(fs.existsSync(path.join(config.workDir, config.outputDir ?? "output", "checkpoint-confirm-review.md")));

    // 模拟真实服务进程丢失内存中的 resume callback，只基于 checkpoint 文件恢复
    const resumed = prepareGraphForResume(pausedGraph);
    saveGraphCheckpoint(config.workDir, resumed);

    resumeFn = null; // 确保旧 callback 不再被使用
    const finalGraph = await run(
      resumed.originalSpec,
      config,
      resumed,
      undefined,
      checkpointPlanner,
      makeMockNodeVerifier(),
    );

    assert.equal(finalGraph.status, "done");
    assert.equal(finalGraph.nodes.get("checkpoint-confirm")?.status, "done");
    assert.equal(finalGraph.nodes.get("impl-main")?.status, "done");

    // 结束最初 paused run，避免悬挂 Promise
    pausedGraph.status = "failed" as const;
    saveGraphCheckpoint(config.workDir, pausedGraph);
  } finally {
    cleanup();
  }
});
