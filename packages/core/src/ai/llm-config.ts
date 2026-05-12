import { resolveModelConfig, type ShipyardConfig } from "../config";
import type { LLMClientConfig } from "./llm";

export function makeLLMConfig(model: string, config: ShipyardConfig): LLMClientConfig {
  return {
    baseURL: config.baseURL,
    apiKey: config.apiKey,
    model,
  };
}


export function makeLLMConfigForRole(role: keyof ReturnType<typeof resolveModelConfig>, config: ShipyardConfig): LLMClientConfig {
  const models = resolveModelConfig(config);
  return makeLLMConfig(models[role], config);
}
