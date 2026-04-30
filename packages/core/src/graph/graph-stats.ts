import type { ExecutionGraph, GraphNode, NodeStatus } from "./index";

export function emptyStatusCount(): Record<NodeStatus, number> {
  return { pending: 0, ready: 0, running: 0, verifying: 0, done: 0, failed: 0, blocked: 0, skipped: 0 };
}

export function recalcGraphStats(nodes: Map<string, GraphNode>): ExecutionGraph["stats"] {
  const byStatus = emptyStatusCount();
  let filesGenerated = 0;
  let verificationsRun = 0;
  let verificationsPassed = 0;

  for (const node of nodes.values()) {
    byStatus[node.status]++;
    if (node.evidence) {
      filesGenerated += node.evidence.filesWritten.length;
      verificationsRun += node.evidence.verifications.length;
      verificationsPassed += node.evidence.verifications.filter((v) => v.passed).length;
    }
  }

  return { total: nodes.size, byStatus, filesGenerated, verificationsRun, verificationsPassed };
}
