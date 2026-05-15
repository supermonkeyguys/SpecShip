import type { SessionExecutionState } from "../../domains/execution/types";
import type { NodeStatus } from "../../types";
import { DEFAULT_NODE_HEIGHT } from "./layout";

export const STATUS_COLORS: Record<NodeStatus["status"], string> = {
  pending: "#9ca3af",
  ready: "#3b82f6",
  running: "#f59e0b",
  verifying: "#8b5cf6",
  done: "#16a34a",
  failed: "#dc2626",
  blocked: "#d1d5db",
  skipped: "#d1d5db",
};

export const STATUS_BG: Record<NodeStatus["status"], string> = {
  pending: "#f9fafb",
  ready: "#eff6ff",
  running: "#fffbeb",
  verifying: "#faf5ff",
  done: "#f0fdf4",
  failed: "#fef2f2",
  blocked: "#f3f4f6",
  skipped: "#f3f4f6",
};

export const NODE_TYPE_LABEL: Record<NodeStatus["nodeType"], string> = {
  implement: "impl",
  checkpoint: "ckpt",
};

export const NODE_ROLE_LABEL: Record<string, string> = {
  types: "types",
  implementer: "impl",
  tester: "test",
  reviewer: "review",
  integrator: "integrate",
};

export const STATUS_LABEL: Record<NodeStatus["status"], string> = {
  pending: "pending",
  ready: "ready",
  running: "running",
  verifying: "verifying",
  done: "done",
  failed: "failed",
  blocked: "blocked",
  skipped: "skipped",
};

export const ERROR_CATEGORY_LABEL: Record<string, string> = {
  compile: "Compile error",
  api: "API error",
  logic: "Logic error",
  timeout: "Timeout",
  unknown: "Error",
};

export const TOOL_ICONS: Record<string, string> = {
  write_file: "✍️",
  read_file: "📖",
  run_command: "⚡",
  search_files: "🔍",
  list_dir: "📂",
};

export const EMPTY_NODES: SessionExecutionState["nodes"] = {};

export function estimateNodeHeight(node: NodeStatus): number {
  if (node.status === "failed" && node.error) {
    return DEFAULT_NODE_HEIGHT + 36;
  }
  return DEFAULT_NODE_HEIGHT;
}

export function isNodeActive(node: NodeStatus): boolean {
  return node.status === "running" || node.status === "verifying";
}
