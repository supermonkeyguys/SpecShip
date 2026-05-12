import * as fs from "fs";
import * as path from "path";
import { ShipyardConfig } from "../config";
import type { GraphNode } from "../graph";
import { runAgent as defaultRunAgent } from "../ai/llm";
import { makeLLMConfig } from "../ai/llm-config";
import { routeModel } from "./model-router";
import type { AgentRunner } from "./runtime-types";
import type { TaskStrategy } from "../strategies/base";
import { typescriptLibStrategy } from "../strategies";
import type { ExecutionLogger } from "./execution-logger";

const REVIEW_SCOPE_NOTE = "Import path style is not blocking if the file compiles; only flag actual acceptance-criteria violations.";

function formatStructuredAcceptance(node: GraphNode): string {
  if (!node.acceptance) return "";
  const parts: string[] = [];
  parts.push(`Structured acceptance summary: ${node.acceptance.summary}`);
  if (node.acceptance.exports?.length) parts.push(`Required exports: ${node.acceptance.exports.join(", ")}`);
  if (node.acceptance.compileRequired !== undefined) parts.push(`Compile required: ${String(node.acceptance.compileRequired)}`);
  if (node.acceptance.testsRequired !== undefined) parts.push(`Tests required: ${String(node.acceptance.testsRequired)}`);
  if (node.acceptance.requiredFiles?.length) parts.push(`Required files: ${node.acceptance.requiredFiles.join(", ")}`);
  if (node.acceptance.forbiddenDependencies?.length) parts.push(`Forbidden dependencies: ${node.acceptance.forbiddenDependencies.join(", ")}`);
  if (node.acceptance.allowedWriteGlobs?.length) parts.push(`Allowed write globs: ${node.acceptance.allowedWriteGlobs.join(", ")}`);
  if (node.acceptance.forbiddenEdits?.length) parts.push(`Forbidden edits: ${node.acceptance.forbiddenEdits.join(", ")}`);
  return parts.join("\n");
}

export async function runCodeReview(
  node: GraphNode,
  outputFiles: string[],
  config: ShipyardConfig,
  agentRunner: AgentRunner = defaultRunAgent,
  logger?: ExecutionLogger,
  strategy?: TaskStrategy
): Promise<{ passed: boolean; blockingIssues: string }> {
  const fileContents = outputFiles
    .filter((f) => fs.existsSync(f))
    .map((f) => `// ${path.relative(config.workDir, f)}\n${fs.readFileSync(f, "utf-8").slice(0, 15000)}`)
    .join("\n\n");

  if (!fileContents) return { passed: true, blockingIssues: "" };

  try {
    const structuredAcceptance = formatStructuredAcceptance(node);
    const criteriaBase = node.acceptanceCriteria && node.acceptanceCriteria !== "undefined"
      ? node.acceptanceCriteria
      : `SCOPE: Review ONLY this single file. Task title: "${node.title}". ` +
        `Check: (1) file is syntactically valid and compiles, ` +
        `(2) file content matches what the title describes. ` +
        `Do NOT fail for missing features that belong to other files/steps. ` +
        `Do NOT require a complete working application from a single file.`;
    const criteria = `${criteriaBase}${structuredAcceptance ? `\n${structuredAcceptance}` : ""}\n${REVIEW_SCOPE_NOTE}`;

    const role = node.nodeRole && node.nodeRole !== "undefined" ? node.nodeRole : "implementer";
    const taskDesc = node.task && node.task !== "undefined" ? node.task : node.inputs?.description ?? node.title;

    const reviewRoute = routeModel(config, {
      phase: "review",
      nodeRole: node.nodeRole,
      retryCount: node.retryCount,
      executionMode: config.executionMode ?? "sandbox-output",
    });
    logger?.log({ event: "review_input", nodeId: node.id, criteria, role, task: taskDesc, codeSnippet: fileContents.slice(0, 500) });

    const { finalText } = await agentRunner(
      (strategy ?? typescriptLibStrategy).reviewerPrompt,
      `Acceptance criteria for this step:\n${criteria}\n\nNode role: ${role}\nTask: ${taskDesc}\n\nCode:\n${fileContents}`,
      config.workDir,
      makeLLMConfig(reviewRoute.model, config),
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
    return { passed: true, blockingIssues: "" };
  }
}
