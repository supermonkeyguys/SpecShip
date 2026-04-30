import type { ShipyardConfig } from "../config";
import type { LLMClientConfig } from "./llm";

export function makeLLMConfig(model: string, config: ShipyardConfig): LLMClientConfig {
  return {
    baseURL: config.baseURL,
    apiKey: config.apiKey,
    model,
  };
}
