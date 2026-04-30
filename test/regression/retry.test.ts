/**
 * 回归路径 2：节点失败后自动重试，最终成功
 *
 * 验证：verify 第一次失败，调度器自动重试，第二次 verify 通过，最终节点 done。
 * verify 失败通过 mockNodeVerifier 注入，不依赖真实 tsc。
 */

import test from "node:test";
import assert from "node:assert/strict";
import { run } from "../../packages/core/src/orchestrator/shipyard";
import { makeMockAgentRunner, makeMockNodeVerifier, makeTestConfig } from "./helpers";

test("retry: node fails on first verify then succeeds on retry", async () => {
  const { config, cleanup } = makeTestConfig("retry");
  // verify 第一次失败，第二次成功
  const nodeVerifier = makeMockNodeVerifier({ failFirstN: 1 });

  try {
    const graph = await run(
      "Write a TypeScript function",
      config,
      undefined,
      undefined,
      makeMockAgentRunner({}),
      nodeVerifier
    );

    assert.equal(graph.status, "done", `expected graph.status=done, got ${graph.status}`);

    // 确认节点经历了重试（retryCount >= 1）
    const nodes = Array.from(graph.nodes.values());
    const retriedNode = nodes.find((n) => n.retryCount > 0);
    assert.ok(retriedNode, "expected at least one node to have been retried");

    // 最终所有节点 done
    for (const node of nodes) {
      assert.equal(node.status, "done", `node ${node.id} expected done, got ${node.status}`);
    }
  } finally {
    cleanup();
  }
});

test("retry: node exhausts maxRetries and ends as failed", async () => {
  const { config, cleanup } = makeTestConfig("retry-exhaust");

  // verify 每次都失败（failFirstN 超出 maxRetries=2）
  const nodeVerifier = makeMockNodeVerifier({ failFirstN: 999 });

  try {
    const graph = await run(
      "Write a TypeScript function",
      config,
      undefined,
      undefined,
      makeMockAgentRunner({}),
      nodeVerifier
    );

    assert.equal(graph.status, "failed", `expected graph.status=failed, got ${graph.status}`);

    // 节点最终是 failed
    const nodes = Array.from(graph.nodes.values());
    const failedNode = nodes.find((n) => n.status === "failed");
    assert.ok(failedNode, "expected at least one failed node");

    // retryCount 达到 maxRetries
    assert.equal(
      failedNode!.retryCount,
      config.maxRetries,
      `expected retryCount=${config.maxRetries}, got ${failedNode!.retryCount}`
    );
  } finally {
    cleanup();
  }
});
