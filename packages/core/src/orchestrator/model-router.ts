import { resolveModelConfig, type ShipyardConfig } from "../config";

export type ModelRoutePhase = "clarify" | "plan" | "execute" | "review";

export interface ModelRouteInput {
  phase: ModelRoutePhase;
  nodeRole?: string;
  retryCount?: number;
  dependsOnCount?: number;
  dependencyContextChars?: number;
  lastErrorKind?: "fatal" | "verify" | "review";
  executionMode?: "sandbox-output" | "repo-edit";
}

export interface ModelRouteResult {
  model: string;
  reason: string;
  complexity: "small" | "medium" | "high";
  risk: "low" | "medium" | "high";
}

function estimateComplexity(input: ModelRouteInput): ModelRouteResult["complexity"] {
  if (input.phase !== "execute") return "medium";

  const dependsOnCount = input.dependsOnCount ?? 0;
  const dependencyContextChars = input.dependencyContextChars ?? 0;

  if (dependsOnCount >= 3 || dependencyContextChars > 12000) return "high";
  if (dependsOnCount >= 1 || dependencyContextChars > 4000) return "medium";
  return "small";
}

function estimateRisk(input: ModelRouteInput, complexity: ModelRouteResult["complexity"]): ModelRouteResult["risk"] {
  if (input.phase === "review") return "high";
  if (input.phase === "plan" || input.phase === "clarify") return "medium";

  const role = input.nodeRole ?? "implementer";
  if (input.executionMode === "repo-edit") {
    return complexity === "small" ? "medium" : "high";
  }
  if (role === "integrator") return "high";
  if (role === "tester" || role === "utility") return complexity === "high" ? "medium" : "low";
  if ((input.retryCount ?? 0) >= 1) return "high";
  if (complexity === "high") return "high";
  if (complexity === "medium") return "medium";
  return "low";
}

export function routeModel(config: ShipyardConfig, input: ModelRouteInput): ModelRouteResult {
  const models = resolveModelConfig(config);
  const retryCount = input.retryCount ?? 0;
  const complexity = estimateComplexity(input);
  const risk = estimateRisk(input, complexity);

  if (input.phase === "clarify") {
    return {
      model: models.clarifier,
      reason: `phase=clarify complexity=${complexity} risk=${risk} -> clarifier model`,
      complexity,
      risk,
    };
  }

  if (input.phase === "plan") {
    return {
      model: models.planner,
      reason: `phase=plan complexity=${complexity} risk=${risk} -> planner model`,
      complexity,
      risk,
    };
  }

  if (input.phase === "review") {
    return {
      model: models.reviewer,
      reason: `phase=review complexity=${complexity} risk=${risk} -> reviewer model`,
      complexity,
      risk,
    };
  }

  const role = input.nodeRole ?? "implementer";
  let model = models.implementer;
  let reason = `phase=execute role=${role} complexity=${complexity} risk=${risk}`;

  if (role === "tester") {
    model = models.tester;
    reason += " -> tester model";
  } else if (role === "integrator") {
    model = models.integrator;
    reason += " -> integrator model";
  } else if (role === "utility") {
    model = models.utility;
    reason += " -> utility model";
  } else {
    if (complexity === "high" || risk === "high") {
      model = models.integrator;
      reason += " -> integrator model";
    } else {
      model = models.implementer;
      reason += " -> implementer model";
    }
  }

  if (retryCount >= 1 && role !== "tester" && role !== "utility" && role !== "integrator") {
    model = models.integrator;
    reason += "; retry>=1 -> escalated to integrator model";
  }

  if (input.lastErrorKind === "review" && role !== "reviewer") {
    model = models.integrator;
    reason += "; lastErrorKind=review -> keep escalated integrator model";
  }

  return { model, reason, complexity, risk };
}
