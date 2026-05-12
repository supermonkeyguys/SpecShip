import test from "node:test";
import assert from "node:assert/strict";

import { toNodeStatus } from "../../apps/server/src/routes/run";
import { createGraph, addNode } from "../../packages/core/src/graph";

test("server: node status payload includes role, task, and acceptance criteria for detail UI", () => {
  let graph = createGraph("spec");
  graph = addNode(graph, {
    id: "test-impl-main",
    type: "implement",
    title: "Test Main implementation",
    specFragment: "Add focused tests for output/main.ts",
    nodeRole: "tester",
    task: "Write a focused test file for output/main.ts covering happy path and edge cases.",
    acceptanceCriteria: "Create output/main.test.ts and ensure it passes in tester verification.",
    skills: ["deferred-testing"],
    dependsOn: ["impl-main"],
    inputs: { description: "Existing implementation in output/main.ts is complete." },
    outputs: {
      description: "Write output/main.test.ts",
      files: ["output/main.test.ts"],
      verificationCriteria: [],
    },
    status: "done",
    maxRetries: 1,
  });

  const node = graph.nodes.get("test-impl-main");
  assert.ok(node);
  const payload = toNodeStatus(node!);

  assert.equal(payload.nodeRole, "tester");
  assert.match(payload.task ?? "", /focused test file/i);
  assert.match(payload.acceptanceCriteria ?? "", /main\.test\.ts/i);
});
