/**
 * 回归路径 4：手动 retry 一个 failed 节点
 *
 * 验证：节点终态为 failed 时，通过 transitionNode(graph, id, "ready") 将其重置，
 * 保存 checkpoint，再次 run() 时节点被重新调度并最终成功。
 *
 * 这条路径对应 POST /api/node/:id/retry 的服务端逻辑。
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  createGraph, addNode, transitionNode,
} from "../../packages/core/src/graph";
import {
  saveGraphCheckpoint, loadGraphCheckpoint,
} from "../../packages/core/src/persistence/checkpoint";
import { run } from "../../packages/core/src/orchestrator/shipyard";
import { makeMockAgentRunner, makeMockNodeVerifier, makeTestConfig } from "./helpers";

test("manual-retry: failed node can be reset to ready via transitionNode", () => {
  // 纯状态机测试，不需要跑 LLM
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
    status: "failed",
    maxRetries: 2,
  });

  // failed → ready 是合法的（VALID_TRANSITIONS.failed = ["ready"]）
  const updated = transitionNode(graph, "impl-main", "ready");
  const node = updated.nodes.get("impl-main")!;
  assert.equal(node.status, "ready", `expected ready, got ${node.status}`);
});

test("manual-retry: cannot transition done node to ready", () => {
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
    status: "done",
    maxRetries: 2,
  });

  // done 是终态，不允许转到 ready
  assert.throws(
    () => transitionNode(graph, "impl-main", "ready"),
    /Invalid transition/,
    "expected transitionNode to throw for done → ready"
  );
});

test("manual-retry: full flow - node fails, manual retry, then succeeds", async () => {
  const { config, cleanup } = makeTestConfig("manual-retry");
  try {
    // 第一次跑：verifier 持续失败，耗尽重试，最终 failed
    const failedGraph = await run(
      "Write a TypeScript function",
      config,
      undefined,
      undefined,
      makeMockAgentRunner({}),
      makeMockNodeVerifier({ failFirstN: 999 })
    );

    assert.equal(failedGraph.status, "failed");

    // 保存到 checkpoint（模拟服务端状态）
    saveGraphCheckpoint(config.workDir, failedGraph);

    // 手动 retry：从 checkpoint 加载，将 failed 节点重置为 ready
    const loaded = loadGraphCheckpoint(config.workDir);
    let retried = loaded;
    for (const node of loaded.nodes.values()) {
      if (node.status === "failed") {
        retried = transitionNode(retried, node.id, "ready");
      }
    }
    saveGraphCheckpoint(config.workDir, retried);

    // 第二次跑：使用不失败的 runner
    const successRunner = makeMockAgentRunner({});
    const finalGraph = await run(
      retried.originalSpec,
      config,
      retried,
      undefined,
      successRunner,
      makeMockNodeVerifier()
    );

    assert.equal(finalGraph.status, "done", `expected done after manual retry, got ${finalGraph.status}`);

    const nodes = Array.from(finalGraph.nodes.values());
    for (const node of nodes) {
      assert.equal(node.status, "done", `node ${node.id} expected done, got ${node.status}`);
    }
  } finally {
    cleanup();
  }
});
