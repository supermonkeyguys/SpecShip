import { ShipyardConfig } from "../config";

// ---- Tool definition (matches OpenAI tool schema) ----

export interface ToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, { type: string; description: string }>;
      required: string[];
    };
  };
}

// ---- Verification config ----

export interface VerifierConfig {
  /** Run tsc --noEmit compile check */
  compile: boolean;
  /** Run behavior verification when explicit tests or tester nodes exist */
  behavior: boolean;
  /** Run eslint (soft-failure, does not block) */
  lint: boolean;
  /** Allowed command prefixes for run_command tool */
  allowedCommands: string[];
}

// ---- Preview config (consumed by frontend) ----

export interface PreviewerConfig {
  /** Preview type identifier matched by frontend PreviewPanel */
  type: "code" | "iframe" | "terminal" | "slide";
  /** File extensions to show in file tree preview */
  previewExtensions: string[];
}

// ---- Planner config ----

export interface PlannerConfig {
  systemPrompt: string;
  /** Allowed output file extensions */
  allowedExtensions: string[];
}

// ---- TaskStrategy ----

export interface TaskStrategy {
  id: string;
  name: string;
  /** Return confidence 0-1 that this strategy matches the given spec */
  detect: (spec: string) => number;
  /** Planner configuration */
  plan: (config: ShipyardConfig) => PlannerConfig;
  /** Tool definitions available to Implementer */
  tools: () => ToolDef[];
  /** Verification configuration */
  verify: () => VerifierConfig;
  /** Preview configuration for frontend */
  preview: () => PreviewerConfig;
  /** Implementer system prompt */
  implementerPrompt: string;
  /** Tester system prompt (optional; falls back to implementerPrompt when omitted) */
  testerPrompt?: string;
  /** Reviewer system prompt */
  reviewerPrompt: string;
}
