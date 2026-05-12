import * as fs from "fs";
import * as path from "path";
import { ShipyardConfig } from "../config";
import { PRD_GENERATOR_PROMPT } from "../ai/prompts";
import { runAgent as defaultRunAgent } from "../ai/llm";
import { makeLLMConfig } from "../ai/llm-config";
import type { AgentRunner } from "./runtime-types";

/**
 * 根据用户粗略需求生成 PRD 草稿（Markdown 字符串）。
 * 同时将 prd.md 持久化到 session 目录。
 */
export async function generatePRD(
  spec: string,
  config: ShipyardConfig,
  agentRunner: AgentRunner = defaultRunAgent
): Promise<string> {
  const llmConfig = makeLLMConfig(config.models.planning, config);

  const { finalText } = await agentRunner(
    PRD_GENERATOR_PROMPT,
    spec,
    config.workDir,
    llmConfig,
    false
  );

  // 持久化到 session 目录（如果有 projectId + sessionId）
  if (config.projectId && config.sessionId) {
    const sessionDir = path.join(
      config.workDir,
      "projects",
      config.projectId,
      "sessions",
      config.sessionId
    );
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(path.join(sessionDir, "prd.md"), finalText, "utf-8");
  }

  return finalText;
}
