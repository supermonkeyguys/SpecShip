// packages/core/src/orchestrator/plan-generator.ts
import * as fs from "fs";
import * as path from "path";
import { ShipyardConfig } from "../config";
import { PLAN_GENERATOR_PROMPT } from "../ai/prompts";
import { runAgent as defaultRunAgent } from "../ai/llm";
import { makeLLMConfig } from "../ai/llm-config";
import { routeModel } from "./model-router";
import type { AgentRunner } from "./runtime-types";

/**
 * Generate a structured plan.md from a spec string.
 * Returns the raw Markdown text. Persists to session dir if projectId+sessionId set.
 */
export async function generatePlan(
  spec: string,
  config: ShipyardConfig,
  agentRunner: AgentRunner = defaultRunAgent
): Promise<string> {
  const route = routeModel(config, { phase: "plan", executionMode: config.executionMode ?? "sandbox-output" });
  const llmConfig = makeLLMConfig(route.model, config);

  const { finalText } = await agentRunner(
    PLAN_GENERATOR_PROMPT,
    spec,
    config.workDir,
    llmConfig,
    false
  );

  // Persist to session directory if available
  if (config.projectId && config.sessionId) {
    const sessionDir = path.join(
      config.workDir,
      ".shipyard",
      "projects",
      config.projectId,
      "sessions",
      config.sessionId
    );
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(path.join(sessionDir, "plan.md"), finalText, "utf-8");
  }

  return finalText;
}
