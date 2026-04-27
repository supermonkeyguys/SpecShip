/**
 * graph.ts — Shipyard 的核心数据结构
 *
 * 整个开发过程是一个"执行图"：
 * - 节点（Node）= 一个有明确输入/输出/验证的任务单元
 * - 边（Edge）  = 节点间的依赖关系
 * - 图（Graph） = 一次完整的开发任务的全貌
 *
 * 设计原则：
 * 1. 每个节点是原子的——要么完整完成，要么完整回滚
 * 2. 每个节点有 evidence——记录做了什么、为什么、结果如何
 * 3. 图是不可变历史——节点状态只能向前推进，不能篡改
 */

// ─────────────────────────────────────────
// 节点状态机
// ─────────────────────────────────────────

export type NodeStatus =
  | "pending"     // 等待依赖完成
  | "ready"       // 依赖已满足，等待调度
  | "running"     // 正在执行
  | "verifying"   // 执行完成，正在验证
  | "done"        // 验证通过，完成
  | "failed"      // 执行或验证失败
  | "blocked"     // 依赖节点失败，无法执行
  | "skipped";    // 被人工跳过

// 状态只能向前，不能回退（除了 failed → ready 的重试）
export const VALID_TRANSITIONS: Record<NodeStatus, NodeStatus[]> = {
  pending:   ["ready", "blocked"],
  ready:     ["running"],
  running:   ["verifying", "failed"],
  verifying: ["done", "failed"],
  done:      [],                      // 终态
  failed:    ["ready"],               // 允许重试
  blocked:   [],                      // 终态（除非依赖被修复）
  skipped:   [],                      // 终态
};

// ─────────────────────────────────────────
// Evidence（证据）— 节点做了什么的完整记录
// ─────────────────────────────────────────

export interface Evidence {
  // 决策记录：为什么这么做
  reasoning: string;          // agent 的推理过程
  promptUsed: string;         // 实际使用的 prompt（截断版）
  modelUsed: string;          // 使用的模型

  // 执行记录：做了什么
  toolCalls: ToolCallRecord[];
  filesWritten: FileRecord[];

  // 验证记录：结果怎么样
  verifications: VerificationRecord[];

  // 时间记录
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
}

export interface ToolCallRecord {
  tool: string;
  input: Record<string, unknown>;
  output: string;             // 截断到 500 字符
  success: boolean;
  timestamp: string;
}

export interface FileRecord {
  path: string;
  operation: "create" | "edit" | "delete";
  sizeBytes: number;
  checksum: string;           // SHA-256，用于检测后续篡改
  timestamp: string;
}

export interface VerificationRecord {
  type: "compile" | "test" | "spec_check" | "lint";
  passed: boolean;
  output: string;
  durationMs: number;
  timestamp: string;
}

// ─────────────────────────────────────────
// 节点类型
// ─────────────────────────────────────────

export type NodeType =
  | "plan"          // 规划节点：解析 spec，生成子节点
  | "implement"     // 实现节点：写一个文件
  | "verify"        // 验证节点：跑测试/编译
  | "integrate"     // 集成节点：合并多个模块的结果
  | "review"        // review 节点：质量检查
  | "checkpoint";   // 检查点：人工确认后才继续

// ─────────────────────────────────────────
// 节点（Node）
// ─────────────────────────────────────────

export interface GraphNode {
  // 身份
  id: string;                 // 唯一 ID，格式: "plan-1", "impl-auth-2"
  type: NodeType;
  title: string;              // 人类可读的标题，显示在画板上

  // 来源追溯
  specFragment: string;       // 这个节点对应 spec 的哪一段
  parentId?: string;          // 由哪个节点派生出来的

  // 依赖关系
  dependsOn: string[];        // 依赖的节点 ID 列表

  // 输入输出契约
  inputs: {
    description: string;      // 需要什么
    files?: string[];         // 需要读取的文件
  };
  outputs: {
    description: string;      // 产出什么
    files?: string[];         // 期望产出的文件
    verificationCriteria: VerificationCriterion[]; // 怎么验证产出
  };

  // 执行状态
  status: NodeStatus;
  retryCount: number;
  maxRetries: number;

  // 证据（执行后填充）
  evidence?: Evidence;

  // 错误信息（失败时填充）
  error?: {
    message: string;
    category: "compile" | "api" | "logic" | "timeout" | "unknown";
    recoverable: boolean;
  };

  // 上一次失败的详细错误输出（重试时注入 prompt，让 LLM 知道哪里错了）
  lastError?: string;

  // 时间戳
  createdAt: string;
  updatedAt: string;
}

// ─────────────────────────────────────────
// 验证标准（从 spec 派生）
// ─────────────────────────────────────────

export interface VerificationCriterion {
  id: string;
  description: string;
  type: "compile" | "test" | "behavior" | "lint";
  hardness?: "hard" | "soft";  // hard=必须通过, soft=尽力而为

  testCase?: {
    input: string;
    expectedOutput: string;
    expectError?: string;
  };
}

// ─────────────────────────────────────────
// 执行图（Graph）
// ─────────────────────────────────────────

export interface ExecutionGraph {
  // 身份
  id: string;
  title: string;

  // 来源
  originalSpec: string;       // 用户输入的原始 spec
  repository?: string;        // 关联的 git 仓库（如果有）

  // 节点集合（Map 保证 O(1) 查找）
  nodes: Map<string, GraphNode>;

  // 图的状态
  status: "building" | "running" | "paused" | "done" | "failed";

  // 统计
  stats: {
    total: number;
    byStatus: Record<NodeStatus, number>;
    filesGenerated: number;
    verificationsRun: number;
    verificationsPassed: number;
  };

  // 时间
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

// ─────────────────────────────────────────
// 图操作（纯函数，不可变）
// ─────────────────────────────────────────

/** 创建新图 */
export function createGraph(spec: string, repository?: string): ExecutionGraph {
  const now = new Date().toISOString();
  return {
    id: `graph-${Date.now()}`,
    title: spec.slice(0, 60),
    originalSpec: spec,
    repository,
    nodes: new Map(),
    status: "building",
    stats: { total: 0, byStatus: emptyStatusCount(), filesGenerated: 0, verificationsRun: 0, verificationsPassed: 0 },
    createdAt: now,
    updatedAt: now,
  };
}

/** 添加节点 */
export function addNode(graph: ExecutionGraph, node: Omit<GraphNode, "createdAt" | "updatedAt" | "retryCount">): ExecutionGraph {
  const now = new Date().toISOString();
  const fullNode: GraphNode = { ...node, retryCount: 0, createdAt: now, updatedAt: now };
  const nodes = new Map(graph.nodes);
  nodes.set(node.id, fullNode);
  return { ...graph, nodes, stats: recalcStats(nodes), updatedAt: now };
}

/** 推进节点状态（校验合法性）*/
export function transitionNode(
  graph: ExecutionGraph,
  nodeId: string,
  newStatus: NodeStatus,
  update?: Partial<Pick<GraphNode, "evidence" | "error">>
): ExecutionGraph {
  const node = graph.nodes.get(nodeId);
  if (!node) throw new Error(`Node not found: ${nodeId}`);

  const allowed = VALID_TRANSITIONS[node.status];
  if (!allowed.includes(newStatus)) {
    throw new Error(`Invalid transition: ${node.status} → ${newStatus} for node ${nodeId}`);
  }

  const now = new Date().toISOString();
  const nodes = new Map(graph.nodes);
  nodes.set(nodeId, { ...node, status: newStatus, ...update, updatedAt: now });

  // 当依赖节点失败时，自动将下游节点标记为 blocked
  let updated = { ...graph, nodes, stats: recalcStats(nodes), updatedAt: now };
  if (newStatus === "failed") {
    updated = blockDownstream(updated, nodeId);
  }

  return updated;
}

/** 依赖是否满足（支持依赖 nodeId 或输出文件路径） */
export function isDependencySatisfied(graph: ExecutionGraph, dependency: string): boolean {
  const depNode = graph.nodes.get(dependency);
  if (depNode?.status === "done") return true;

  return Array.from(graph.nodes.values()).some(
    (n) => n.status === "done" && (n.outputs.files ?? []).includes(dependency)
  );
}

/** 找出当前可以运行的节点 */
export function getReadyNodes(graph: ExecutionGraph): GraphNode[] {
  return Array.from(graph.nodes.values()).filter((n) => {
    if (n.status !== "ready") return false;
    return n.dependsOn.every((dependency) => isDependencySatisfied(graph, dependency));
  });
}

/** 找出需要人工确认的节点 */
export function getCheckpointNodes(graph: ExecutionGraph): GraphNode[] {
  return Array.from(graph.nodes.values()).filter(
    (n) => n.type === "checkpoint" && n.status === "ready"
  );
}

/** 生成人类可读的执行历史 */
export function buildHistory(graph: ExecutionGraph): HistoryEntry[] {
  const entries: HistoryEntry[] = [];

  for (const node of graph.nodes.values()) {
    if (!node.evidence) continue;

    entries.push({
      nodeId: node.id,
      nodeTitle: node.title,
      specFragment: node.specFragment,
      status: node.status,
      filesWritten: node.evidence.filesWritten.map((f) => f.path),
      verifications: node.evidence.verifications.map((v) => ({
        type: v.type,
        passed: v.passed,
        summary: v.output.slice(0, 100),
      })),
      reasoning: node.evidence.reasoning,
      timestamp: node.evidence.startedAt,
      durationMs: node.evidence.durationMs,
    });
  }

  return entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export interface HistoryEntry {
  nodeId: string;
  nodeTitle: string;
  specFragment: string;       // 对应 spec 的哪段需求
  status: NodeStatus;
  filesWritten: string[];
  verifications: Array<{ type: string; passed: boolean; summary: string }>;
  reasoning: string;          // AI 的推理
  timestamp: string;
  durationMs?: number;
}

// ─────────────────────────────────────────
// 内部工具函数
// ─────────────────────────────────────────

function emptyStatusCount(): Record<NodeStatus, number> {
  return { pending: 0, ready: 0, running: 0, verifying: 0, done: 0, failed: 0, blocked: 0, skipped: 0 };
}

function recalcStats(nodes: Map<string, GraphNode>): ExecutionGraph["stats"] {
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

function blockDownstream(graph: ExecutionGraph, failedId: string): ExecutionGraph {
  const nodes = new Map(graph.nodes);
  const now = new Date().toISOString();

  for (const node of nodes.values()) {
    if (node.status === "pending" && node.dependsOn.includes(failedId)) {
      nodes.set(node.id, { ...node, status: "blocked", updatedAt: now });
      // 递归阻塞下游
      graph = blockDownstream({ ...graph, nodes }, node.id);
    }
  }

  return { ...graph, nodes };
}
