import * as fs from "fs";
import * as path from "path";
import { ShipyardConfig } from "../config";
import { GRAPH_PLANNER_PROMPT, CLARIFIER_PROMPT } from "../ai/prompts";
import type { TaskStrategy } from "../strategies/base";
import { typescriptLibStrategy } from "../strategies";
import { extractRepoContext } from "../context/repo";
import { ExecutionGraph, createGraph, addNode } from "../graph";
import { runAgent as defaultRunAgent } from "../ai/llm";
import { makeLLMConfig } from "../ai/llm-config";
import { getExecutionMode, normalizeSandboxOutputFile, validateOutputPath } from "./output-policy";
import { routeModel } from "./model-router";
import type { AgentRunner, ClarificationResult } from "./runtime-types";

type PlannerStep = {
  id: string;
  title: string;
  specFragment: string;
  nodeRole?: string;
  task?: string;
  acceptanceCriteria?: string;
  acceptance?: {
    summary: string;
    exports?: string[];
    compileRequired?: boolean;
    testsRequired?: boolean;
    requiredFiles?: string[];
    forbiddenDependencies?: string[];
    allowedWriteGlobs?: string[];
    forbiddenEdits?: string[];
  };
  skills?: string[];
  description: string;
  outputFile: string;
  dependsOn: string[];
  role: string;
};

type PlannerPlan = {
  title: string;
  ambiguities: string[];
  steps: PlannerStep[];
};

const MAX_PLANNER_ATTEMPTS = 4;

function findDuplicates(values: string[]): string[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([value]) => value);
}

function normalizeStepOutputFile(outputFile: string, config: ShipyardConfig): string {
  return normalizeSandboxOutputFile(outputFile, config);
}

function normalizePlanData(planData: PlannerPlan, config: ShipyardConfig): PlannerPlan {
  return {
    ...planData,
    ambiguities: planData.ambiguities ?? [],
    steps: (planData.steps ?? []).map((step) => ({
      ...step,
      dependsOn: step.dependsOn ?? [],
      outputFile: normalizeStepOutputFile(step.outputFile, config),
    })),
  };
}

function parsePlanData(finalText: string): PlannerPlan {
  const match = finalText.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON in response");
  return JSON.parse(match[0]) as PlannerPlan;
}

export function validatePlanData(planData: PlannerPlan, config: ShipyardConfig, strategy?: TaskStrategy): string[] {
  const issues: string[] = [];

  const duplicateStepIds = findDuplicates(planData.steps.map((s) => s.id));
  if (duplicateStepIds.length) {
    issues.push(`Duplicate step ids: ${duplicateStepIds.join(", ")}`);
  }

  const duplicateFiles = findDuplicates(planData.steps.map((s) => s.outputFile));
  if (duplicateFiles.length) {
    issues.push(`Duplicate files: ${duplicateFiles.join(", ")}`);
  }

  const allowedExtensions = new Set((strategy ?? typescriptLibStrategy).plan(config).allowedExtensions);
  for (const step of planData.steps) {
    const outputPathError = validateOutputPath(step.outputFile, config);
    if (outputPathError) {
      issues.push(`Step "${step.id}" has invalid outputFile: ${outputPathError}`);
    }

    if (step.role !== "checkpoint") {
      const ext = path.extname(step.outputFile);
      if (!ext || !allowedExtensions.has(ext)) {
        issues.push(`Step "${step.id}" has unsupported output extension "${ext || "(none)"}" for strategy ${(strategy ?? typescriptLibStrategy).id}`);
      }
    }
  }

  const stepIds = new Set(planData.steps.map((s) => s.id));
  for (const step of planData.steps) {
    const invalidDeps = step.dependsOn.filter((d) => !stepIds.has(d));
    if (invalidDeps.length) {
      issues.push(`Step "${step.id}" has unknown dependsOn: ${invalidDeps.join(", ")}`);
    }
  }

  const cycle = detectDependencyCycle(planData.steps);
  if (cycle) {
    issues.push(`Dependency cycle detected: ${cycle.join(" -> ")}`);
  }

  return issues;
}

function logPlanIssues(issues: string[]): void {
  for (const issue of issues) {
    console.error(`  ✗ ${issue}`);
  }
}

function buildPlannerRepairInput(originalInput: string, invalidPlanText: string, issues: string[]): string {
  return `${originalInput}

Your previous plan was invalid. Rebuild the FULL plan from scratch and fix every validation error below.

Validation errors:
${issues.map((issue) => `- ${issue}`).join("\n")}

Previous invalid plan:
${invalidPlanText.slice(0, 8000)}

Hard requirements:
- Output ONLY a JSON object, no markdown
- Each step id must be unique
- Each step outputFile must be unique
- Each step must write exactly one file
- dependsOn may reference ONLY existing step ids
- No dependency cycles
- outputFile must stay within the provided Output directory
- Keep the same project intent, but correct the structure so the plan is executable`;
}

function normalizeAcceptance(
  step: {
    title: string;
    outputFile: string;
    acceptanceCriteria?: string;
    acceptance?: {
      summary: string;
      exports?: string[];
      compileRequired?: boolean;
      testsRequired?: boolean;
      requiredFiles?: string[];
      forbiddenDependencies?: string[];
      allowedWriteGlobs?: string[];
      forbiddenEdits?: string[];
    };
  }
): {
  summary: string;
  exports?: string[];
  compileRequired?: boolean;
  testsRequired?: boolean;
  requiredFiles?: string[];
  forbiddenDependencies?: string[];
  allowedWriteGlobs?: string[];
  forbiddenEdits?: string[];
} | undefined {
  const base = step.acceptance;
  const summary = base?.summary?.trim() || step.acceptanceCriteria?.trim() || `Complete ${step.title}`;
  const normalized = {
    ...base,
    summary,
    exports: base?.exports?.filter(Boolean),
    requiredFiles: base?.requiredFiles?.filter(Boolean),
    forbiddenDependencies: base?.forbiddenDependencies?.filter(Boolean),
    allowedWriteGlobs: base?.allowedWriteGlobs?.filter(Boolean),
    forbiddenEdits: base?.forbiddenEdits?.filter(Boolean),
  };

  const hasMeaningfulField = Boolean(
    normalized.summary ||
    normalized.exports?.length ||
    normalized.requiredFiles?.length ||
    normalized.forbiddenDependencies?.length ||
    normalized.allowedWriteGlobs?.length ||
    normalized.forbiddenEdits?.length ||
    normalized.compileRequired !== undefined ||
    normalized.testsRequired !== undefined
  );

  return hasMeaningfulField ? normalized : undefined;
}

function detectDependencyCycle(steps: Array<{ id: string; dependsOn: string[] }>): string[] | null {
  const graph = new Map(steps.map((step) => [step.id, step.dependsOn]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  const visit = (nodeId: string): string[] | null => {
    if (visiting.has(nodeId)) {
      const cycleStart = stack.indexOf(nodeId);
      return [...stack.slice(cycleStart), nodeId];
    }
    if (visited.has(nodeId)) return null;

    visiting.add(nodeId);
    stack.push(nodeId);

    for (const depId of graph.get(nodeId) ?? []) {
      const cycle = visit(depId);
      if (cycle) return cycle;
    }

    stack.pop();
    visiting.delete(nodeId);
    visited.add(nodeId);
    return null;
  };

  for (const step of steps) {
    const cycle = visit(step.id);
    if (cycle) return cycle;
  }

  return null;
}

/**
 * 在规划前检查 spec 是否有歧义，返回结构化问题列表。
 * 调用方可根据结果决定是否向用户展示问题，并将答案 append 回 spec 再规划。
 */
export async function clarifySpec(
  spec: string,
  config: ShipyardConfig,
  agentRunner: AgentRunner = defaultRunAgent
): Promise<ClarificationResult> {
  const clarifierRoute = routeModel(config, { phase: "clarify", executionMode: config.executionMode ?? "sandbox-output" });
  const llmConfig = makeLLMConfig(clarifierRoute.model, config);
  const { finalText } = await agentRunner(CLARIFIER_PROMPT, spec, config.workDir, llmConfig, false);

  try {
    const match = finalText.match(/\{[\s\S]*\}/);
    if (!match) return { needsClarification: false, questions: [], confidence: "high", summary: "" };
    return JSON.parse(match[0]) as ClarificationResult;
  } catch {
    return { needsClarification: false, questions: [], confidence: "high", summary: "" };
  }
}

// ---- Phase 1: 规划 → 构建执行图 ----

export async function buildGraph(
  spec: string,
  config: ShipyardConfig,
  agentRunner: AgentRunner = defaultRunAgent,
  /** If provided, called when spec needs clarification. Resolve with amended spec to continue, or reject to abort. */
  onClarify?: (result: ClarificationResult) => Promise<string>,
  strategy?: TaskStrategy
): Promise<ExecutionGraph | null> {
  console.log("\n[PLANNING] Building execution graph...");

  // 歧义检测：在规划前先问 LLM 这个 spec 是否需要澄清
  if (onClarify) {
    try {
      const clarification = await clarifySpec(spec, config, agentRunner);
      if (clarification.needsClarification && clarification.questions.length > 0) {
        console.log(`  ❓ Spec needs clarification (confidence: ${clarification.confidence})`);
        clarification.questions.forEach((q, i) => console.log(`     Q${i + 1}: ${q.text}`));
        // 调用方提供答案后返回增强后的 spec
        spec = await onClarify(clarification);
        console.log("  ✅ Spec clarified, proceeding with planning");
      }
    } catch (e) {
      console.warn(`  ⚠️  Clarification step failed, proceeding anyway: ${(e as Error).message}`);
    }
  }

  const executionMode = getExecutionMode(config);
  if (executionMode === "repo-edit" && !config.repoPath) {
    console.error("  ✗ repo-edit mode requires repoPath");
    return null;
  }

  // outputDir：session 模式下用独立目录，否则用默认 output/
  const outputDir = config.outputDir ?? "output";
  if (executionMode === "sandbox-output") {
    fs.mkdirSync(path.join(config.workDir, outputDir), { recursive: true });
  }

  // 如果有仓库路径，提取上下文注入 spec
  let enrichedSpec = spec;
  if (config.repoPath) {
    try {
      const repoCtx = extractRepoContext(config.repoPath);
      enrichedSpec = `${repoCtx.summary}\n\n=== Task ===\n${spec}`;
      console.log(`  📂 Repo context loaded: ${config.repoPath}`);
    } catch (e) {
      console.warn(`  ⚠️  Failed to load repo context: ${(e as Error).message}`);
    }
  }

  // 告诉 Planner 文件应该写在哪个目录
  const plannerInput = `Output directory: ${outputDir}\n\n${enrichedSpec}`;

  const plannerRoute = routeModel(config, { phase: "plan", executionMode: config.executionMode ?? "sandbox-output" });
  const llmConfig = makeLLMConfig(plannerRoute.model, config);
  const plannerPrompt = (strategy ?? typescriptLibStrategy).plan(config).systemPrompt;

  let planData: PlannerPlan | null = null;
  let currentPlannerInput = plannerInput;

  for (let attempt = 1; attempt <= MAX_PLANNER_ATTEMPTS; attempt += 1) {
    const { finalText } = await agentRunner(plannerPrompt, currentPlannerInput, config.workDir, llmConfig, false);

    let parsed: PlannerPlan;
    try {
      parsed = normalizePlanData(parsePlanData(finalText), config);
    } catch (e) {
      if (attempt < MAX_PLANNER_ATTEMPTS) {
        const issue = `Planner response was not valid JSON: ${(e as Error).message}`;
        console.warn(`  ⚠️  ${issue}. Retrying planner (${attempt}/${MAX_PLANNER_ATTEMPTS})...`);
        currentPlannerInput = buildPlannerRepairInput(plannerInput, finalText, [issue]);
        continue;
      }

      console.error(`  ✗ Failed to parse plan: ${(e as Error).message}`);
      console.error(`  Raw: ${finalText.slice(0, 300)}`);
      return null;
    }

    const issues = validatePlanData(parsed, config, strategy);
    if (issues.length === 0) {
      planData = parsed;
      break;
    }

    if (attempt < MAX_PLANNER_ATTEMPTS) {
      console.warn(`  ⚠️  Planner produced invalid plan. Retrying planner (${attempt}/${MAX_PLANNER_ATTEMPTS})...`);
      issues.forEach((issue) => console.warn(`     - ${issue}`));
      currentPlannerInput = buildPlannerRepairInput(plannerInput, JSON.stringify(parsed, null, 2), issues);
      continue;
    }

    logPlanIssues(issues);
    return null;
  }

  if (!planData) {
    console.error("  ✗ Planner did not produce a valid executable plan");
    return null;
  }

  // 构建图
  let graph = createGraph(spec);
  graph = { ...graph, title: planData.title };

  if (planData.ambiguities?.length) {
    console.log("  ℹ️  Assumptions:");
    planData.ambiguities.forEach((a) => console.log(`     • ${a}`));
  }

  for (const step of planData.steps) {
    const isCheckpoint = step.role === "checkpoint";
    graph = addNode(graph, {
      id: step.id,
      type: isCheckpoint ? "checkpoint" : "implement",
      title: step.title,
      specFragment: step.specFragment,
      nodeRole: step.nodeRole ?? step.role ?? "implementer",
      task: step.task ?? step.description,
      acceptanceCriteria: step.acceptanceCriteria ??
        `SCOPE: Review ONLY ${step.outputFile}. Check: (1) file is syntactically valid and compiles, (2) implements what "${step.title}" describes. Do NOT require other files or a complete application.`,
      acceptance: normalizeAcceptance(step),
      skills: step.skills ?? [],
      dependsOn: step.dependsOn,
      inputs: { description: step.description },
      outputs: {
        description: isCheckpoint ? `Checkpoint: ${step.title}` : `Write ${step.outputFile}`,
        files: isCheckpoint ? [] : [step.outputFile],
        verificationCriteria: [],
      },
      status: step.dependsOn.length === 0 ? "ready" : "pending",
      maxRetries: isCheckpoint ? 0 : config.maxRetries,
    });
  }

  // 打印图结构
  const nodes = Array.from(graph.nodes.values());
  console.log(`  → ${nodes.length} node(s)`);
  nodes.forEach((n) => {
    const deps = n.dependsOn.length ? ` ← ${n.dependsOn.join(", ")}` : " (start)";
    const typeTag = n.type === "checkpoint" ? " ⏸ " : " ";
    console.log(`     [${n.id}]${typeTag}${n.title}${deps}`);
  });

  return graph;
}
