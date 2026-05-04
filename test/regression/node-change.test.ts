/**
 * node-change.test.ts — 节点变更 → 子图重算 回归测试
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import {
  createGraph, addNode, transitionNode,
  computeAffectedNodeIds, analyzeChangeImpact,
  applyNodeChange, editNodeAndRecalculate,
  sortAffectedByTopo,
} from "../../packages/core/src/graph";

function buildTestGraph() {
  // node-1 (root) → node-2, node-3
  // node-2 → node-4
  // node-3 → node-5
  // node-4, node-5 are leaves
  let g = createGraph("test");
  g = addNode(g, { id: "node-1", type: "implement", title: "Root", specFragment: "", nodeRole: "implementer", task: "", acceptanceCriteria: "", skills: [], dependsOn: [], inputs: { description: "" }, outputs: { description: "", files: ["o1.ts"], verificationCriteria: [] }, status: "ready", maxRetries: 2 });
  g = addNode(g, { id: "node-2", type: "implement", title: "Child A", specFragment: "", nodeRole: "implementer", task: "", acceptanceCriteria: "", skills: [], dependsOn: ["node-1"], inputs: { description: "" }, outputs: { description: "", files: ["o2.ts"], verificationCriteria: [] }, status: "ready", maxRetries: 2 });
  g = addNode(g, { id: "node-3", type: "implement", title: "Child B", specFragment: "", nodeRole: "implementer", task: "", acceptanceCriteria: "", skills: [], dependsOn: ["node-1"], inputs: { description: "" }, outputs: { description: "", files: ["o3.ts"], verificationCriteria: [] }, status: "ready", maxRetries: 2 });
  g = addNode(g, { id: "node-4", type: "implement", title: "Grandchild A", specFragment: "", nodeRole: "implementer", task: "", acceptanceCriteria: "", skills: [], dependsOn: ["node-2"], inputs: { description: "" }, outputs: { description: "", files: ["o4.ts"], verificationCriteria: [] }, status: "ready", maxRetries: 2 });
  g = addNode(g, { id: "node-5", type: "implement", title: "Grandchild B", specFragment: "", nodeRole: "implementer", task: "", acceptanceCriteria: "", skills: [], dependsOn: ["node-3"], inputs: { description: "" }, outputs: { description: "", files: ["o5.ts"], verificationCriteria: [] }, status: "ready", maxRetries: 2 });
  return g;
}

describe("computeAffectedNodeIds", () => {
  it("changing a root node affects all downstream nodes", () => {
    const g = buildTestGraph();
    const affected = computeAffectedNodeIds(g, "node-1");
    assert.equal(affected.size, 5);
    assert.ok(affected.has("node-1"));
    assert.ok(affected.has("node-2"));
    assert.ok(affected.has("node-3"));
    assert.ok(affected.has("node-4"));
    assert.ok(affected.has("node-5"));
  });

  it("changing a mid-level node affects only its downstream branch", () => {
    const g = buildTestGraph();
    const affected = computeAffectedNodeIds(g, "node-2");
    assert.equal(affected.size, 2);
    assert.ok(affected.has("node-2"));
    assert.ok(affected.has("node-4"));
  });

  it("changing a leaf node affects only itself", () => {
    const g = buildTestGraph();
    const affected = computeAffectedNodeIds(g, "node-4");
    assert.equal(affected.size, 1);
    assert.ok(affected.has("node-4"));
  });

  it("parallel branch is NOT affected", () => {
    const g = buildTestGraph();
    const affected = computeAffectedNodeIds(g, "node-2");
    assert.ok(!affected.has("node-3"));
    assert.ok(!affected.has("node-5"));
  });
});

describe("sortAffectedByTopo", () => {
  it("returns nodes in topological order (dependencies first)", () => {
    const g = buildTestGraph();
    const affected = computeAffectedNodeIds(g, "node-1");
    const sorted = sortAffectedByTopo(g, affected);
    // node-1 must be before node-2 and node-3
    // node-2 must be before node-4, node-3 before node-5
    const idx1 = sorted.indexOf("node-1");
    const idx2 = sorted.indexOf("node-2");
    const idx3 = sorted.indexOf("node-3");
    const idx4 = sorted.indexOf("node-4");
    const idx5 = sorted.indexOf("node-5");
    assert.ok(idx1 < idx2, "node-1 before node-2");
    assert.ok(idx1 < idx3, "node-1 before node-3");
    assert.ok(idx2 < idx4, "node-2 before node-4");
    assert.ok(idx3 < idx5, "node-3 before node-5");
  });
});

describe("analyzeChangeImpact", () => {
  it("correctly classifies nodes into valid and rerun sets", () => {
    const g = buildTestGraph();
    const impact = analyzeChangeImpact(g, {
      nodeId: "node-2",
      kind: "content",
      description: "test change",
    });

    assert.equal(impact.nodesNeedRerun.length, 2);
    assert.equal(impact.nodesStillValid.length, 3);
    assert.equal(impact.totalAffected, 2);
    assert.equal(impact.totalUnaffected, 3);

    const rerunIds = impact.nodesNeedRerun.map((n) => n.id);
    assert.ok(rerunIds.includes("node-2"));
    assert.ok(rerunIds.includes("node-4"));

    const validIds = impact.nodesStillValid.map((n) => n.id);
    assert.ok(validIds.includes("node-1"));
    assert.ok(validIds.includes("node-3"));
    assert.ok(validIds.includes("node-5"));
  });
});

describe("applyNodeChange", () => {
  it("resets affected nodes to ready and clears evidence", () => {
    let g = buildTestGraph();
    // Mark nodes as done with evidence (through valid state transitions)
    g = transitionNode(g, "node-1", "running");
    g = transitionNode(g, "node-1", "done", {
      evidence: { reasoning: "test", promptUsed: "", modelUsed: "", toolCalls: [], filesWritten: [], verifications: [], startedAt: new Date().toISOString() },
    });
    g = transitionNode(g, "node-2", "running");
    g = transitionNode(g, "node-2", "done", {
      evidence: { reasoning: "test", promptUsed: "", modelUsed: "", toolCalls: [], filesWritten: [], verifications: [], startedAt: new Date().toISOString() },
    });

    // Change node-1 → node-2 and node-4 should reset
    const newGraph = applyNodeChange(g, { nodeId: "node-1", kind: "content", description: "changed" });

    // node-1 reset
    const n1 = newGraph.nodes.get("node-1")!;
    assert.equal(n1.status, "ready");
    assert.equal(n1.evidence, undefined);
    assert.equal(n1.retryCount, 0);

    // node-2 reset (downstream)
    const n2 = newGraph.nodes.get("node-2")!;
    assert.equal(n2.status, "ready");
    assert.equal(n2.evidence, undefined);

    // node-3 unaffected (depends on node-1 but that's being reset, not failing)
    // Actually, node-3 depends on node-1. When node-1 resets, node-3 should also reset.
    // Wait — node-3 also depends on node-1. So it should be reset too.
    const n3 = newGraph.nodes.get("node-3")!;
    assert.equal(n3.status, "ready", "node-3 should also reset since it depends on node-1");
    assert.equal(n3.evidence, undefined);
  });

  it("does not touch unaffected nodes", () => {
    let g = buildTestGraph();
    // Put node-3 and node-5 in done state with evidence (through valid transitions)
    g = transitionNode(g, "node-3", "running");
    g = transitionNode(g, "node-3", "done", {
      evidence: { reasoning: "valid", promptUsed: "", modelUsed: "", toolCalls: [], filesWritten: [], verifications: [], startedAt: new Date().toISOString() },
    });
    g = transitionNode(g, "node-5", "running");
    g = transitionNode(g, "node-5", "done", {
      evidence: { reasoning: "valid", promptUsed: "", modelUsed: "", toolCalls: [], filesWritten: [], verifications: [], startedAt: new Date().toISOString() },
    });

    // Change node-2 (parallel to node-3 branch)
    const newGraph = applyNodeChange(g, { nodeId: "node-2", kind: "content", description: "changed" });

    // node-3 untouched (parallel branch)
    const n3 = newGraph.nodes.get("node-3")!;
    assert.equal(n3.status, "done");
    assert.ok(n3.evidence);
    assert.equal(n3.evidence!.reasoning, "valid");

    // node-5 untouched
    const n5 = newGraph.nodes.get("node-5")!;
    assert.equal(n5.status, "done");
    assert.ok(n5.evidence);
  });
});

describe("editNodeAndRecalculate", () => {
  it("detects content change and returns impact analysis", () => {
    const g = buildTestGraph();
    const { graph, impact } = editNodeAndRecalculate(g, "node-1", { title: "New Root Title" });

    assert.equal(impact.changeKind, "content");
    assert.ok(impact.description.includes("title"));
    assert.equal(impact.totalAffected, 5);

    const n1 = graph.nodes.get("node-1")!;
    assert.equal(n1.title, "New Root Title");
    assert.equal(n1.status, "ready");
  });

  it("detects dependency change", () => {
    const g = buildTestGraph();
    // Make node-4 also depend on node-3
    const { graph, impact } = editNodeAndRecalculate(g, "node-4", { dependsOn: ["node-2", "node-3"] });

    assert.equal(impact.changeKind, "dependency");
    const n4 = graph.nodes.get("node-4")!;
    assert.deepEqual([...n4.dependsOn].sort(), ["node-2", "node-3"]);
  });
});
