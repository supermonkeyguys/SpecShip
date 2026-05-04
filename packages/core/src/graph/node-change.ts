/**
 * node-change.ts — 节点变更 → 子图重算
 *
 * 当用户编辑节点后，计算受影响的下游子图：
 * - 哪些节点继续有效（证据保留）
 * - 哪些节点需要重算（证据作废）
 * - 为什么
 */

import type { ExecutionGraph, GraphNode } from "./graph";
import { replaceGraphNodes } from "./graph";

// ─────────────────────────────────────────
// 变更类型
// ─────────────────────────────────────────

export type NodeChangeKind = "content" | "dependency" | "criteria" | "mixed";

export interface NodeChange {
  nodeId: string;
  kind: NodeChangeKind;
  /** Human-readable description of what changed */
  description: string;
}

// ─────────────────────────────────────────
// 影响分析结果
// ─────────────────────────────────────────

export interface ChangeImpact {
  changedNodeId: string;
  changeKind: NodeChangeKind;
  description: string;
  nodesStillValid: ImpactEntry[];
  nodesNeedRerun: ImpactEntry[];
  totalAffected: number;
  totalUnaffected: number;
}

export interface ImpactEntry {
  id: string;
  title: string;
  reason: string;
}

// ─────────────────────────────────────────
// 下游传递闭包计算
// ─────────────────────────────────────────

/**
 * 从 changedNodeId 出发，沿依赖边向下传递，找出所有受影响的节点（含自身）。
 * 只走下游，不影响上游（依赖）或平行分支。
 */
export function computeAffectedNodeIds(
  graph: ExecutionGraph,
  changedNodeId: string
): Set<string> {
  const affected = new Set<string>([changedNodeId]);

  // BFS：每次发现新受影响的节点，把直接下游也加进来
  const queue = [changedNodeId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const node of graph.nodes.values()) {
      if (affected.has(node.id)) continue;
      if (node.dependsOn.includes(current)) {
        affected.add(node.id);
        queue.push(node.id);
      }
    }
  }

  return affected;
}

/**
 * 对受影响节点集，按拓扑序排列（深层在前，便于按序重算）。
 */
export function sortAffectedByTopo(
  graph: ExecutionGraph,
  affectedIds: Set<string>
): string[] {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const id of affectedIds) {
    inDegree.set(id, 0);
    adjacency.set(id, []);
  }

  for (const node of graph.nodes.values()) {
    if (!affectedIds.has(node.id)) continue;
    for (const depId of node.dependsOn) {
      if (!affectedIds.has(depId)) continue;
      // depId → node.id 有边
      adjacency.get(depId)!.push(node.id);
      inDegree.set(node.id, (inDegree.get(node.id) ?? 0) + 1);
    }
  }

  // Kahn
  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);
    for (const nextId of adjacency.get(current) ?? []) {
      const newDegree = (inDegree.get(nextId) ?? 1) - 1;
      inDegree.set(nextId, newDegree);
      if (newDegree === 0) queue.push(nextId);
    }
  }

  return sorted;
}

// ─────────────────────────────────────────
// 影响分析（供 UI 展示）
// ─────────────────────────────────────────

export function analyzeChangeImpact(
  graph: ExecutionGraph,
  change: NodeChange
): ChangeImpact {
  const affectedIds = computeAffectedNodeIds(graph, change.nodeId);
  const allNodes = Array.from(graph.nodes.values());

  const nodesNeedRerun: ImpactEntry[] = [];
  const nodesStillValid: ImpactEntry[] = [];

  for (const node of allNodes) {
    if (affectedIds.has(node.id)) {
      const reason = node.id === change.nodeId
        ? `This node was modified (${change.kind} change)`
        : `Depends on changed node (via ${node.dependsOn.filter((d) => affectedIds.has(d)).join(", ")})`;
      nodesNeedRerun.push({ id: node.id, title: node.title, reason });
    } else {
      const reason = node.dependsOn.length === 0
        ? "Root node, unaffected by downstream changes"
        : `Does not depend on any changed node`;
      nodesStillValid.push({ id: node.id, title: node.title, reason });
    }
  }

  return {
    changedNodeId: change.nodeId,
    changeKind: change.kind,
    description: change.description,
    nodesStillValid,
    nodesNeedRerun,
    totalAffected: nodesNeedRerun.length,
    totalUnaffected: nodesStillValid.length,
  };
}

// ─────────────────────────────────────────
// 应用变更：重置受影响节点
// ─────────────────────────────────────────

/**
 * 将受影响节点重置为 ready，清除 evidence/error/lastError。
 * 未受影响的节点不受任何影响。
 *
 * 规则：
 * - changedNodeId 自身：重置为 ready，清除全部 evidence
 * - 下游节点：同样重置为 ready，清除 evidence
 * - 上游节点：不动
 * - 平行分支：不动
 * - checkpoint 节点在受影响路径中也重置
 */
export function applyNodeChange(
  graph: ExecutionGraph,
  change: NodeChange
): ExecutionGraph {
  const affectedIds = computeAffectedNodeIds(graph, change.nodeId);
  const nodes = new Map(graph.nodes);

  for (const [id, node] of nodes) {
    if (affectedIds.has(id)) {
      nodes.set(id, {
        ...node,
        status: "ready",
        retryCount: 0,
        evidence: undefined,
        error: undefined,
        lastError: undefined,
        lastErrorKind: undefined,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  return replaceGraphNodes(graph, nodes);
}

/**
 * 合并节点更新到图中（用户编辑节点属性后调用）。
 * 自动检测变更类型并计算影响域，返回更新后的图和影响分析。
 */
export function editNodeAndRecalculate(
  graph: ExecutionGraph,
  nodeId: string,
  updates: Partial<Pick<GraphNode, "title" | "task" | "specFragment" | "acceptanceCriteria" | "dependsOn">>
): { graph: ExecutionGraph; impact: ChangeImpact } {
  // 先更新节点内容
  const nodes = new Map(graph.nodes);
  const existing = nodes.get(nodeId);
  if (!existing) throw new Error(`Node not found: ${nodeId}`);

  // 检测变更类型
  const kind = classifyChange(existing, updates);
  const description = buildChangeDescription(existing, updates, kind);

  nodes.set(nodeId, {
    ...existing,
    ...updates,
    updatedAt: new Date().toISOString(),
  });

  const patchedGraph = replaceGraphNodes(graph, nodes);
  const change: NodeChange = { nodeId, kind, description };
  const impact = analyzeChangeImpact(patchedGraph, change);

  // 应用重算
  const finalGraph = applyNodeChange(patchedGraph, change);

  return { graph: finalGraph, impact };
}

// ─────────────────────────────────────────
// 内部辅助
// ─────────────────────────────────────────

function classifyChange(
  existing: GraphNode,
  updates: Partial<Pick<GraphNode, "title" | "task" | "specFragment" | "acceptanceCriteria" | "dependsOn">>
): NodeChangeKind {
  const contentChanged = Boolean(
    (updates.title !== undefined && updates.title !== existing.title) ||
    (updates.task !== undefined && updates.task !== existing.task) ||
    (updates.specFragment !== undefined && updates.specFragment !== existing.specFragment)
  );
  const criteriaChanged = Boolean(
    updates.acceptanceCriteria !== undefined && updates.acceptanceCriteria !== existing.acceptanceCriteria
  );
  const depsChanged = Boolean(
    updates.dependsOn !== undefined &&
    JSON.stringify([...updates.dependsOn].sort()) !== JSON.stringify([...existing.dependsOn].sort())
  );

  const flags = [contentChanged, criteriaChanged, depsChanged].filter(Boolean).length;
  if (flags > 1) return "mixed";
  if (contentChanged) return "content";
  if (criteriaChanged) return "criteria";
  if (depsChanged) return "dependency";
  return "content"; // fallback
}

function buildChangeDescription(
  existing: GraphNode,
  updates: Partial<Pick<GraphNode, "title" | "task" | "specFragment" | "acceptanceCriteria" | "dependsOn">>,
  kind: NodeChangeKind
): string {
  const parts: string[] = [];
  if (updates.title !== undefined && updates.title !== existing.title)
    parts.push(`title: "${existing.title}" → "${updates.title}"`);
  if (updates.task !== undefined && updates.task !== existing.task)
    parts.push("task updated");
  if (updates.specFragment !== undefined && updates.specFragment !== existing.specFragment)
    parts.push("spec fragment updated");
  if (updates.acceptanceCriteria !== undefined && updates.acceptanceCriteria !== existing.acceptanceCriteria)
    parts.push("acceptance criteria updated");
  if (updates.dependsOn !== undefined) {
    const added = updates.dependsOn.filter((d) => !existing.dependsOn.includes(d));
    const removed = existing.dependsOn.filter((d) => !updates.dependsOn!.includes(d));
    if (added.length) parts.push(`added dependency on: ${added.join(", ")}`);
    if (removed.length) parts.push(`removed dependency on: ${removed.join(", ")}`);
  }
  return parts.join("; ") || `${kind} change`;
}
