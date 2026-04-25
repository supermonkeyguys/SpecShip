export interface ShipyardConfig {
  workDir: string;
  maxRetries: number;
  baseURL: string;   // OpenAI 兼容接口地址
  apiKey: string;    // API Key
  models: {
    planning:       string;
    implementation: string;
    review:         string;
  };
}

export const DEFAULT_CONFIG: ShipyardConfig = {
  workDir:    process.cwd(),
  maxRetries: 2,
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
