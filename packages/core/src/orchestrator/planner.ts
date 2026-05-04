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
import { validateOutputPath } from "./output-policy";
import type { AgentRunner, ClarificationResult } from "./runtime-types";

function findDuplicates(values: string[]): string[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([value]) => value);
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
  const llmConfig = makeLLMConfig(config.models.planning, config);
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

  // outputDir：session 模式下用独立目录，否则用默认 output/
  const outputDir = config.outputDir ?? "output";
  fs.mkdirSync(path.join(config.workDir, outputDir), { recursive: true });

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

  const llmConfig = makeLLMConfig(config.models.planning, config);
  const plannerPrompt = (strategy ?? typescriptLibStrategy).plan(config).systemPrompt;
  const { finalText } = await agentRunner(plannerPrompt, plannerInput, config.workDir, llmConfig, false);

  let planData: {
    title: string;
    ambiguities: string[];
    steps: Array<{
      id: string; title: string; specFragment: string;
      nodeRole?: string; task?: string; acceptanceCriteria?: string; skills?: string[];
      description: string; outputFile: string; dependsOn: string[]; role: string;
    }>;
  };

  try {
    const match = finalText.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON in response");
    planData = JSON.parse(match[0]);
  } catch (e) {
    console.error(`  ✗ Failed to parse plan: ${(e as Error).message}`);
    console.error(`  Raw: ${finalText.slice(0, 300)}`);
    return null;
  }

  // step id 唯一性校验
  const duplicateStepIds = findDuplicates(planData.steps.map((s) => s.id));
  if (duplicateStepIds.length) {
    console.error(`  ✗ Duplicate step ids: ${duplicateStepIds.join(", ")}`);
    return null;
  }

  // 文件唯一性校验
  const duplicateFiles = findDuplicates(planData.steps.map((s) => s.outputFile));
  if (duplicateFiles.length) {
    console.error(`  ✗ Duplicate files: ${duplicateFiles.join(", ")}`);
    return null;
  }

  // outputDir 边界校验
  for (const step of planData.steps) {
    const outputPathError = validateOutputPath(step.outputFile, config);
    if (outputPathError) {
      console.error(`  ✗ Step "${step.id}" has invalid outputFile: ${outputPathError}`);
      return null;
    }
  }

  // dependsOn 合法性校验
  const stepIds = new Set(planData.steps.map((s) => s.id));
  for (const step of planData.steps) {
    const invalidDeps = step.dependsOn.filter((d) => !stepIds.has(d));
    if (invalidDeps.length) {
      console.error(`  ✗ Step "${step.id}" has unknown dependsOn: ${invalidDeps.join(", ")}`);
      return null;
    }
  }

  const cycle = detectDependencyCycle(planData.steps);
  if (cycle) {
    console.error(`  ✗ Dependency cycle detected: ${cycle.join(" -> ")}`);
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
