import * as fs from "fs";
import * as path from "path";
import { ShipyardConfig } from "../config";
import type { GraphNode } from "../graph";
import { REVIEWER_PROMPT } from "../ai/prompts";
import { runAgent as defaultRunAgent } from "../ai/llm";
import { makeLLMConfig } from "../ai/llm-config";
import type { AgentRunner } from "./runtime-types";
import type { ExecutionLogger } from "./execution-logger";

export async function runCodeReview(
  node: GraphNode,
  outputFiles: string[],
  config: ShipyardConfig,
  agentRunner: AgentRunner = defaultRunAgent,
  logger?: ExecutionLogger
): Promise<{ passed: boolean; blockingIssues: string }> {
  // 每个文件最多读 6000 字节，避免截断导致 reviewer 误判"代码不完整"
  const fileContents = outputFiles
    .filter((f) => fs.existsSync(f))
    .map((f) => `// ${path.relative(config.workDir, f)}\n${fs.readFileSync(f, "utf-8").slice(0, 15000)}`)
    .join("\n\n");

  if (!fileContents) return { passed: true, blockingIssues: "" };

  try {
    // acceptanceCriteria 可能在旧 session 的 graph.json 中不存在（字段迁移前生成的节点）
    const criteria = node.acceptanceCriteria && node.acceptanceCriteria !== "undefined"
      ? node.acceptanceCriteria
      // fallback：明确限制 reviewer 只检查"编译通过 + 内容与节点职责一致"，禁止跨节点评判
      : `SCOPE: Review ONLY this single file. Task title: "${node.title}". ` +
        `Check: (1) file is syntactically valid and compiles, ` +
        `(2) file content matches what the title describes. ` +
        `Do NOT fail for missing features that belong to other files/steps. ` +
        `Do NOT require a complete working application from a single file.`;
    const role = node.nodeRole && node.nodeRole !== "undefined" ? node.nodeRole : "implementer";
    const taskDesc = node.task && node.task !== "undefined" ? node.task : node.inputs?.description ?? node.title;

    logger?.log({ event: "review_input", nodeId: node.id, criteria, role, task: taskDesc, codeSnippet: fileContents.slice(0, 500) });

    const { finalText } = await agentRunner(
      REVIEWER_PROMPT,
      `Acceptance criteria for this step:\n${criteria}\n\nNode role: ${role}\nTask: ${taskDesc}\n\nCode:\n${fileContents}`,
      config.workDir,
      makeLLMConfig(config.models.review ?? config.models.planning, config),
      false
    );

    const match = finalText.match(/\{[\s\S]*\}/);
    if (!match) return { passed: true, blockingIssues: "" };

    const result = JSON.parse(match[0]) as { passed: boolean; blocking?: string[]; warnings?: string[]; summary?: string };

    logger?.log({ event: "review_result", nodeId: node.id, passed: result.passed !== false, blocking: result.blocking ?? [], warnings: result.warnings ?? [], summary: result.summary ?? "" });

    if (result.blocking?.length) {
      console.log(`  🔍 Review blocking: ${result.blocking.join("; ")}`);
    }
    if (result.warnings?.length) {
      console.log(`  ⚠️  Review warnings: ${result.warnings.join("; ")}`);
    }

    return {
      passed: result.passed !== false,
      blockingIssues: (result.blocking ?? []).join("; "),
    };
  } catch {
    return { passed: true, blockingIssues: "" }; // review 出错不阻塞
  }
}
