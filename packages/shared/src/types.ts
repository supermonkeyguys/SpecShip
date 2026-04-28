/**
 * types.ts — 前后端共享类型
 *
 * 规则：所有跨越 server/client 边界的类型只在这里定义。
 * 前后端都从这里 import，不重复定义。
 */

// ---- 节点状态（UI 展示用，从 GraphNode 提炼）----

export interface NodeStatus {
  id: string;
  title: string;
  status: "pending" | "ready" | "running" | "verifying" | "done" | "failed" | "blocked" | "skipped";
  specFragment: string;
  dependsOn: string[];
  filesWritten: string[];
  verifications: Array<{ type: string; passed: boolean; summary: string }>;
  retryCount: number;
  error?: string;
  durationMs?: number;
}

// ---- SSE 事件（服务端推送给客户端）----

export type SSEEventType = "node_update" | "graph_done" | "graph_failed" | "log";

export interface SSEEvent {
  type: SSEEventType;
  payload: NodeStatus | GraphSummary | string;
}

// ---- 图摘要（graph_done / graph_failed 时推送）----

export interface GraphSummary {
  id: string;
  title: string;
  status: "done" | "failed";
  stats: {
    total: number;
    done: number;
    failed: number;
    filesGenerated: number;
    verificationsPassed: number;
    verificationsRun: number;
  };
  durationMs: number;
}

// ---- REST API 请求/响应 ----

export interface RunRequest {
  spec: string;
  repoPath?: string;  // 已有仓库路径（可选）
}

export interface RunResponse {
  ok: boolean;
  graphId?: string;
  projectId?: string;
  sessionId?: string;
  error?: string;
}

// ---- Projects API ----

export interface ProjectsResponse {
  projects: Array<{
    id: string;
    name: string;
    repoPath?: string;
    createdAt: string;
    updatedAt: string;
    sessions: Array<{
      id: string;
      spec: string;
      status: string;
      createdAt: string;
    }>;
  }>;
}

export interface RetryResponse {
  ok: boolean;
  error?: string;
}

export interface FileEntry {
  path: string;
  sizeBytes: number;
  updatedAt: string;
}

export interface FilesResponse {
  files: FileEntry[];
}

// ---- Clarify API ----

export interface ClarifyOption {
  id: string;         // "a" | "b" | "c" (frontend always appends "other")
  label: string;
  description: string;
}

export interface ClarifyQuestion {
  id: string;               // "q1" | "q2" ...
  text: string;
  mode: "options" | "free";
  options?: ClarifyOption[]; // present when mode=options, AI generates 3-4
}

export interface ClarifyRequest {
  spec: string;
}

export interface ClarifyResponse {
  ok: boolean;
  needsClarification: boolean;
  questions: ClarifyQuestion[];
  confidence: "high" | "medium" | "low";
  summary: string;
}

// ---- Chat API ----

// ---- Status API ----

export interface StatusResponse {
  isRunning: boolean;
  canResume: boolean;
  spec?: string;
  nodeCount?: number;
  doneCount?: number;
}

export interface ResumeResponse {
  ok: boolean;
  graphId?: string;
  error?: string;
}

export interface ChatRequest {
  message: string;
  // 当前图状态（供 LLM 理解上下文）
  currentNodes?: Array<{ id: string; title: string; status: string }>;
  currentSpec?: string;
}

export type ChatIntent =
  | { type: "retry_node"; nodeId: string; reply: string }
  | { type: "new_run"; spec: string; repoPath?: string; reply: string }
  | { type: "resume"; reply: string }
  | { type: "status"; reply: string }
  | { type: "unknown"; reply: string };

export interface ChatResponse {
  ok: boolean;
  intent: ChatIntent;
  error?: string;
}
