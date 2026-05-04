import { TaskStrategy } from "./base";
import { typescriptLibStrategy } from "./typescript-lib";
import { staticWebStrategy } from "./static-web";
import { reactAppStrategy } from "./react-app";
import { nodeServerStrategy } from "./node-server";

// ---- Registry ----

const registry: TaskStrategy[] = [typescriptLibStrategy, staticWebStrategy, reactAppStrategy, nodeServerStrategy];

export function registerStrategy(strategy: TaskStrategy): void {
  const existing = registry.findIndex((s) => s.id === strategy.id);
  if (existing >= 0) {
    registry[existing] = strategy;
  } else {
    registry.push(strategy);
  }
}

export function getStrategy(id: string): TaskStrategy | undefined {
  return registry.find((s) => s.id === id);
}

export function listStrategies(): ReadonlyArray<TaskStrategy> {
  return registry;
}

// ---- Detection ----

/**
 * Detect the best strategy for a given spec.
 * Returns the strategy with the highest confidence score.
 * Currently always returns typescript-lib (the only registered strategy).
 */
export function detectStrategy(spec: string): TaskStrategy {
  let best = typescriptLibStrategy;
  let bestScore = 0;

  for (const strategy of registry) {
    const score = strategy.detect(spec);
    if (score > bestScore) {
      bestScore = score;
      best = strategy;
    }
  }

  return best;
}

export { typescriptLibStrategy } from "./typescript-lib";
export { staticWebStrategy } from "./static-web";
export { reactAppStrategy } from "./react-app";
export { nodeServerStrategy } from "./node-server";
export type { TaskStrategy, ToolDef, VerifierConfig, PreviewerConfig, PlannerConfig } from "./base";
