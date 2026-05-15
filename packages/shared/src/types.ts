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
  nodeType: "implement" | "checkpoint";
  nodeRole?: string;
  task?: string;
  acceptanceCriteria?: string;
  specFragment: string;
  dependsOn: string[];
  filesWritten: string[];
  toolCalls?: Array<{
    tool: string;
    input: Record<string, unknown>;
    output: string;
    success: boolean;
    timestamp: string;
  }>;
  verifications: Array<{ type: string; passed: boolean; summary: string }>;
  retryCount: number;
  maxRetries: number;
  promptUsed?: string;
  error?: string;
  errorCategory?: "compile" | "api" | "logic" | "timeout" | "unknown";
  errorRecoverable?: boolean;
  durationMs?: number;
}

// ---- SSE 事件（服务端推送给客户端）----

export type SSEEventType = "node_update" | "graph_done" | "graph_failed" | "log";

export interface SSEEvent {
  type: SSEEventType;
  payload: NodeStatus | GraphSummary | string;
  projectId?: string;
  sessionId?: string;
}

// ---- 图摘要（graph_done / graph_failed 时推送）----

export interface GraphSummary {
  id: string;
  title: string;
  status: "done" | "failed";
  strategyId?: string;
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
  repoPath?: string;
  strategyId?: string;
  mode?: "spec" | "plan";
  llm?: {
    baseURL?: string;
    apiKey?: string;
  };
}

export interface RunResponse {
  ok: boolean;
  graphId?: string;
  projectId?: string;
  sessionId?: string;
  strategyId?: string;
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
      starred?: boolean;
      createdAt: string;
    }>;
  }>;
}

export interface RetryResponse {
  ok: boolean;
  graphId?: string;
  projectId?: string;
  sessionId?: string;
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

export type PreviewKind = "none" | "static" | "live";
export type LivePreviewStatus = "idle" | "starting" | "running" | "error";

export interface PreviewStatusResponse {
  ok: boolean;
  supported: boolean;
  kind: PreviewKind;
  url?: string;
  entryPath?: string;
  reason?: string;
  staticSupported?: boolean;
  staticUrl?: string;
  liveSupported?: boolean;
  liveStatus?: LivePreviewStatus;
  liveUrl?: string;
  livePort?: number;
  liveCommand?: string;
  liveError?: string;
}


// ---- PRD API ----

export interface PRDRequest {
  spec: string;
  projectId?: string;
  sessionId?: string;
  llm?: {
    baseURL?: string;
    apiKey?: string;
  };
}

export interface PRDResponse {
  ok: boolean;
  prd?: string;
  error?: string;
}

// ---- Plan API ----

export interface PlanRequest {
  spec: string;
  llm?: {
    baseURL?: string;
    apiKey?: string;
  };
}

export interface PlanResponse {
  ok: boolean;
  plan?: string;
  error?: string;
}

// ---- Clarify API ----

export interface ClarifyOption {
  id: string;
  label: string;
  description: string;
}

export interface ClarifyQuestion {
  id: string;
  text: string;
  mode: "options" | "free";
  options?: ClarifyOption[];
}

export interface ClarifyRequest {
  spec: string;
  llm?: {
    baseURL?: string;
    apiKey?: string;
  };
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
  projectId?: string;
  sessionId?: string;
}

export interface ResumeResponse {
  ok: boolean;
  graphId?: string;
  projectId?: string;
  sessionId?: string;
  error?: string;
}

// ---- Node Edit API ----

export interface NodeEditRequest {
  projectId: string;
  sessionId: string;
  updates: {
    title?: string;
    task?: string;
    specFragment?: string;
    acceptanceCriteria?: string;
    dependsOn?: string[];
  };
}

export interface NodeEditImpact {
  changedNodeId: string;
  changeKind: "content" | "dependency" | "criteria" | "mixed";
  description: string;
  nodesStillValid: Array<{ id: string; title: string; reason: string }>;
  nodesNeedRerun: Array<{ id: string; title: string; reason: string }>;
  totalAffected: number;
  totalUnaffected: number;
}

export interface NodeEditResponse {
  ok: boolean;
  impact?: NodeEditImpact;
  error?: string;
}

export interface ChatRequest {
  message: string;
  currentNodes?: Array<{ id: string; title: string; status: string }>;
  currentSpec?: string;
  llm?: {
    baseURL?: string;
    apiKey?: string;
  };
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

export interface LLMSettingsPayload {
  baseURL: string;
  apiKey: string;
  hasApiKey?: boolean;
}

export interface LLMSettingsResponse extends LLMSettingsPayload {
  ok: boolean;
  error?: string;
}

// ---- Session-first Event Sourcing ----

export type SessionOperationActor = "system" | "user" | "server";
export type SessionOperationSource = "run" | "resume" | "retry" | "checkpoint" | "scheduler";

export type SessionOperationType =
  | "session.created"
  | "session.status_set"
  | "graph.initialized"
  | "node.status_set"
  | "node.evidence_appended"
  | "node.retry_scheduled"
  | "checkpoint.paused"
  | "checkpoint.resumed"
  | "graph.completed"
  | "graph.failed";

export interface SessionOperationV1 {
  v: 1;
  opId: string;
  projectId: string;
  sessionId: string;
  sessionRevision: number;
  at: string;
  actor: SessionOperationActor;
  source: SessionOperationSource;
  type: SessionOperationType;
  payload: Record<string, unknown>;
}

export interface SessionProjectionNode {
  id: string;
  status: NodeStatus["status"];
  retryCount: number;
  maxRetries: number;
  error?: string;
  filesWritten: string[];
}

export interface SessionProjection {
  projectId: string;
  sessionId: string;
  revision: number;
  graph: {
    id?: string;
    title?: string;
    status?: "building" | "running" | "paused" | "done" | "failed";
  };
  sessionStatus?: "running" | "paused" | "done" | "failed" | "interrupted";
  nodes: Record<string, SessionProjectionNode>;
}
