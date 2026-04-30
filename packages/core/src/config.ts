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
  models: {
    planning:       string;
    implementation: string;
    review:         string;   // code review，默认用 planning 模型
  };
}

export const DEFAULT_CONFIG: ShipyardConfig = {
  workDir:    process.cwd(),
  maxRetries: 5,
  baseURL:    process.env.OPENAI_BASE_URL ?? process.env.ANTHROPIC_BASE_URL ?? "https://api.openai.com/v1",
  apiKey:     process.env.OPENAI_API_KEY  ?? process.env.ANTHROPIC_API_KEY  ?? "",
  models: {
    planning:       process.env.MODEL_PLANNING       ?? "gpt-5.1",
    implementation: process.env.MODEL_IMPLEMENTATION ?? "gpt-5.1",
    review:         process.env.MODEL_REVIEW         ?? "gpt-5.1",
  },
};

export function loadLLMConfigFromEnv(): Partial<ShipyardConfig> {
  return {
    baseURL: process.env.OPENAI_BASE_URL ?? process.env.ANTHROPIC_BASE_URL,
    apiKey:  process.env.OPENAI_API_KEY  ?? process.env.ANTHROPIC_API_KEY,
    models: {
      planning:       process.env.MODEL_PLANNING       ?? DEFAULT_CONFIG.models.planning,
      implementation: process.env.MODEL_IMPLEMENTATION ?? DEFAULT_CONFIG.models.implementation,
      review:         process.env.MODEL_REVIEW         ?? DEFAULT_CONFIG.models.review,
    },
  };
}
