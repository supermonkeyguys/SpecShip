/**
 * 回归路径 1：run() 完整成功
 *
 * 验证：给定一个单节点 spec，run() 最终返回 status=done，
 * 所有节点 done，输出文件存在于磁盘。
 */

import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { run } from "../../packages/core/src/shipyard";
import { makeMockAgentRunner, makeMockNodeVerifier, makeTestConfig } from "./helpers";

test("run: single node completes successfully", async () => {
  const { config, cleanup } = makeTestConfig("basic");
  const agentRunner = makeMockAgentRunner({});

  try {
    const graph = await run("Write a simple TypeScript function", config, undefined, undefined, agentRunner, makeMockNodeVerifier());

    // graph 整体状态
    assert.equal(graph.status, "done", `expected graph.status=done, got ${graph.status}`);

    // 所有节点都是 done
    const nodes = Array.from(graph.nodes.values());
    assert.ok(nodes.length > 0, "expected at least one node");
    for (const node of nodes) {
      assert.equal(node.status, "done", `node ${node.id} expected done, got ${node.status}`);
    }

    // 统计
    assert.equal(graph.stats.byStatus.failed, 0, "expected 0 failed nodes");
    assert.ok(graph.stats.filesGenerated > 0, "expected at least one file generated");

    // 输出文件实际存在
    for (const node of nodes) {
      for (const fileRecord of (node.evidence?.filesWritten ?? [])) {
        const fullPath = path.resolve(config.workDir, fileRecord.path);
        assert.ok(fs.existsSync(fullPath), `output file missing: ${fileRecord.path}`);
      }
    }
  } finally {
    cleanup();
  }
});

test("run: returns failed graph when planner returns no JSON", async () => {
  const { config, cleanup } = makeTestConfig("bad-plan");

  // agentRunner 对 planner 返回无效内容
  const badRunner = makeMockAgentRunner({});
  const brokenRunner: typeof badRunner = async (systemPrompt, ...rest) => {
    if (systemPrompt.includes("senior software architect") || systemPrompt.includes("implementation plan")) {
      return { finalText: "no json here", toolExecutions: [], tokensUsed: 0 };
    }
    return badRunner(systemPrompt, ...rest);
  };

  try {
    const graph = await run("Write something", config, undefined, undefined, brokenRunner, makeMockNodeVerifier());
    assert.equal(graph.status, "failed", `expected graph.status=failed, got ${graph.status}`);
  } finally {
    cleanup();
  }
});
