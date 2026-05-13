// packages/core/src/orchestrator/plan-parser.ts
import { ShipyardConfig } from "../config";
import { validatePlanData } from "./planner";
import type { TaskStrategy } from "../strategies/base";

export interface ParsedPlanStep {
  id: string;
  title: string;
  role: string;
  file: string;
  depends: string[];
  checkpoint: boolean;
  task: string;
  acceptance: string;
}

export interface ParsedPlan {
  title: string;
  goal: string;
  constraints: string[];
  assumptions: string[];
  steps: ParsedPlanStep[];
}

export interface PlanParseResult {
  ok: boolean;
  plan?: ParsedPlan;
  errors?: string[];
}

/**
 * Deterministically parse a plan.md string into a ParsedPlan.
 * No LLM calls. Returns errors array on any structural problem.
 */
export function parsePlan(markdown: string): PlanParseResult {
  const errors: string[] = [];
  const lines = markdown.split("\n");

  // ---- Extract title (first # heading) ----
  const titleLine = lines.find((l) => l.startsWith("# "));
  const title = titleLine ? titleLine.slice(2).trim() : "";
  if (!title) errors.push("Missing # title heading");

  // ---- Extract header sections ----
  function extractSection(heading: string): string[] {
    const startIdx = lines.findIndex((l) => l.trim() === `## ${heading}`);
    if (startIdx === -1) return [];
    const result: string[] = [];
    for (let i = startIdx + 1; i < lines.length; i++) {
      if (lines[i].startsWith("## ") || lines[i].startsWith("---")) break;
      const stripped = lines[i].replace(/^- /, "").trim();
      if (stripped) result.push(stripped);
    }
    return result;
  }

  const goalLines = extractSection("目标");
  const goal = goalLines.join(" ").trim();
  const constraints = extractSection("技术约束");
  const assumptions = extractSection("假设");

  // ---- Extract steps ----
  const steps: ParsedPlanStep[] = [];
  const stepHeadingRe = /^### step:\s*(.+)$/;

  let i = 0;
  while (i < lines.length) {
    const match = stepHeadingRe.exec(lines[i]);
    if (!match) { i++; continue; }

    const stepId = match[1].trim();
    const fields: Record<string, string> = {};
    i++;

    // Read field lines until next ### or end
    while (i < lines.length && !lines[i].startsWith("### ")) {
      const fieldMatch = /^- (\w+):\s*(.*)$/.exec(lines[i]);
      if (fieldMatch) {
        const key = fieldMatch[1];
        const val = fieldMatch[2].trim();
        if (val === "|") {
          // multiline value: collect indented lines
          const indentedLines: string[] = [];
          i++;
          while (i < lines.length && (lines[i].startsWith("    ") || lines[i] === "")) {
            indentedLines.push(lines[i].replace(/^    /, ""));
            i++;
          }
          fields[key] = indentedLines.join("\n").trim();
          continue;
        } else {
          fields[key] = val;
        }
      }
      i++;
    }

    // Parse depends array: "[a, b, c]" or "[]"
    let depends: string[] = [];
    if (fields.depends) {
      const inner = fields.depends.replace(/^\[/, "").replace(/\]$/, "").trim();
      depends = inner ? inner.split(",").map((s) => s.trim()).filter(Boolean) : [];
    }

    const checkpoint = fields.checkpoint?.toLowerCase() === "true";

    if (!fields.title) errors.push(`Step "${stepId}": missing title`);
    if (!fields.role) errors.push(`Step "${stepId}": missing role`);
    if (!fields.file && !checkpoint) errors.push(`Step "${stepId}": missing file`);
    if (!fields.task) errors.push(`Step "${stepId}": missing task`);

    steps.push({
      id: stepId,
      title: fields.title ?? "",
      role: fields.role ?? "implementer",
      file: fields.file ?? `output/${stepId}.md`,
      depends,
      checkpoint,
      task: fields.task ?? "",
      acceptance: fields.acceptance ?? "",
    });
  }

  if (steps.length === 0) errors.push("No steps found — missing '## 步骤' section or ### step: blocks");

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, plan: { title, goal, constraints, assumptions, steps } };
}

/**
 * Convert ParsedPlan into the shape validatePlanData expects,
 * then run semantic validation (duplicate ids, dependency cycles, etc.)
 */
export function validateParsedPlan(
  parsed: ParsedPlan,
  config: ShipyardConfig,
  strategy?: TaskStrategy
): string[] {
  const plannerPlan = {
    title: parsed.title,
    ambiguities: parsed.assumptions,
    steps: parsed.steps.map((s) => ({
      id: s.id,
      title: s.title,
      specFragment: s.task.slice(0, 100),
      nodeRole: s.role,
      task: s.task,
      acceptanceCriteria: s.acceptance,
      skills: [] as string[],
      description: s.task,
      outputFile: s.file,
      dependsOn: s.depends,
      role: s.checkpoint ? "checkpoint" : s.role,
    })),
  };

  return validatePlanData(plannerPlan, config, strategy);
}
