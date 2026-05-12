export type ShipyardExecutionMode = "sandbox-output" | "repo-edit";

export interface ShipyardWorkspacePolicy {
  allowedWriteGlobs?: string[];
  forbiddenPaths?: string[];
}

export interface ShipyardModelConfig {
  clarifier: string;
  planner: string;
  implementer: string;
  reviewer: string;
  tester: string;
  integrator: string;
  utility: string;
  /** Back-compat aliases */
  planning: string;
  implementation: string;
  review: string;
}

export interface ShipyardConfig {
  workDir: string;
  maxRetries: number;
  baseURL: string;
  apiKey: string;
  repoPath?: string;
  // Session 隔离：每个 session 有独立的 outputDir
  projectId?: string;
  sessionId?: string;
  outputDir?: string;  // 默认 workDir/output，session 模式下为 session 专属目录
  executionMode?: ShipyardExecutionMode;
  workspacePolicy?: ShipyardWorkspacePolicy;
  models: ShipyardModelConfig;
}

export const DEFAULT_CONFIG: ShipyardConfig = {
  workDir:    process.cwd(),
  maxRetries: 5,
  baseURL:    process.env.OPENAI_BASE_URL ?? process.env.ANTHROPIC_BASE_URL ?? "https://api.openai.com/v1",
  apiKey:     process.env.OPENAI_API_KEY  ?? process.env.ANTHROPIC_API_KEY  ?? "",
  executionMode: "sandbox-output",
  models: {
    clarifier:      process.env.MODEL_CLARIFIER      ?? process.env.MODEL_PLANNING       ?? "gpt-5.1",
    planner:        process.env.MODEL_PLANNER        ?? process.env.MODEL_PLANNING       ?? "gpt-5.1",
    implementer:    process.env.MODEL_IMPLEMENTER    ?? process.env.MODEL_IMPLEMENTATION ?? "gpt-5.1",
    reviewer:       process.env.MODEL_REVIEWER       ?? process.env.MODEL_REVIEW         ?? process.env.MODEL_PLANNING ?? "gpt-5.1",
    tester:         process.env.MODEL_TESTER         ?? process.env.MODEL_IMPLEMENTATION ?? "gpt-5.1",
    integrator:     process.env.MODEL_INTEGRATOR     ?? process.env.MODEL_PLANNING       ?? "gpt-5.1",
    utility:        process.env.MODEL_UTILITY        ?? process.env.MODEL_IMPLEMENTATION ?? "gpt-5.1",
    planning:       process.env.MODEL_PLANNING       ?? "gpt-5.1",
    implementation: process.env.MODEL_IMPLEMENTATION ?? "gpt-5.1",
    review:         process.env.MODEL_REVIEW         ?? "gpt-5.1",
  },
};

export function loadLLMConfigFromEnv(): Partial<ShipyardConfig> {
  const models = resolveModelConfig({
    models: {
      clarifier:      process.env.MODEL_CLARIFIER      ?? DEFAULT_CONFIG.models.clarifier,
      planner:        process.env.MODEL_PLANNER        ?? process.env.MODEL_PLANNING       ?? DEFAULT_CONFIG.models.planner,
      implementer:    process.env.MODEL_IMPLEMENTER    ?? process.env.MODEL_IMPLEMENTATION ?? DEFAULT_CONFIG.models.implementer,
      reviewer:       process.env.MODEL_REVIEWER       ?? process.env.MODEL_REVIEW         ?? DEFAULT_CONFIG.models.reviewer,
      tester:         process.env.MODEL_TESTER         ?? DEFAULT_CONFIG.models.tester,
      integrator:     process.env.MODEL_INTEGRATOR     ?? DEFAULT_CONFIG.models.integrator,
      utility:        process.env.MODEL_UTILITY        ?? DEFAULT_CONFIG.models.utility,
      planning:       process.env.MODEL_PLANNING       ?? DEFAULT_CONFIG.models.planning,
      implementation: process.env.MODEL_IMPLEMENTATION ?? DEFAULT_CONFIG.models.implementation,
      review:         process.env.MODEL_REVIEW         ?? DEFAULT_CONFIG.models.review,
    },
  });

  return {
    baseURL: process.env.OPENAI_BASE_URL ?? process.env.ANTHROPIC_BASE_URL,
    apiKey:  process.env.OPENAI_API_KEY  ?? process.env.ANTHROPIC_API_KEY,
    executionMode: process.env.SHIPYARD_EXECUTION_MODE === "repo-edit" ? "repo-edit" : undefined,
    models,
  };
}


export function resolveModelConfig(config: Pick<ShipyardConfig, "models">): ShipyardModelConfig {
  const models = config.models;
  const planning = models.planning ?? models.planner ?? DEFAULT_CONFIG.models.planner;
  const implementation = models.implementation ?? models.implementer ?? DEFAULT_CONFIG.models.implementer;
  const review = models.review ?? models.reviewer ?? planning;

  return {
    clarifier: models.clarifier ?? planning,
    planner: models.planner ?? planning,
    implementer: models.implementer ?? implementation,
    reviewer: models.reviewer ?? review,
    tester: models.tester ?? implementation,
    integrator: models.integrator ?? planning,
    utility: models.utility ?? implementation,
    planning,
    implementation,
    review,
  };
}
