import type { ShipyardConfig } from "../config";
import type { Evidence, GraphNode } from "../graph";
import type { LLMClientConfig, AgentRunResult, ToolExecution } from "../ai/llm";
import type { NodeVerificationResult } from "../verification/verify";

// AgentRunner 是 LLM 调用的抽象接口。
// 生产代码使用 defaultRunAgent；测试和 Temporal Activity 可注入替代实现。
export type AgentRunner = (
  systemPrompt: string,
  userPrompt: string,
  workDir: string,
  config: LLMClientConfig,
  withTools?: boolean,
  onToolCall?: (execution: ToolExecution) => void
) => Promise<AgentRunResult>;

// NodeVerifier 是验证步骤的抽象接口。
// 生产代码使用 defaultVerifyNode；测试可注入直接返回 passed=true 的实现。
export type NodeVerifier = (
  specFragment: string,
  outputFiles: string[],
  workDir: string,
  config: ShipyardConfig
) => Promise<NodeVerificationResult>;

export interface ClarificationQuestion {
  id: string;
  text: string;
  mode: "options" | "free";
  options?: Array<{ id: string; label: string; description: string }>;
}

export interface ClarificationResult {
  needsClarification: boolean;
  questions: ClarificationQuestion[];
  confidence: "high" | "medium" | "low";
  summary: string;
}

export type CheckpointHandler = (node: GraphNode, resume: () => void) => void;

export type ToolCallAccumulator = Evidence["toolCalls"];
