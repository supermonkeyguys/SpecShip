import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import { buildGraph } from "../../packages/core/src/orchestrator/planner";
import type { ShipyardConfig } from "../../packages/core/src/config";
import type { AgentRunner } from "../../packages/core/src/orchestrator/runtime-types";

function makeConfig(name: string): { config: ShipyardConfig; cleanup: () => void } {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `shipyard-planner-normalize-${name}-`));
  return {
    config: {
      workDir,
      outputDir: ".shipyard/projects/proj-x/sessions/sess-y/output",
      maxRetries: 1,
      baseURL: "http://mock",
      apiKey: "mock",
      models: {
        clarifier: "mock-model",
        planner: "mock-model",
        implementer: "mock-model",
        reviewer: "mock-model",
        tester: "mock-model",
        integrator: "mock-model",
        utility: "mock-model",
        planning: "mock-model",
        implementation: "mock-model",
        review: "mock-model",
      },
    },
    cleanup: () => fs.rmSync(workDir, { recursive: true, force: true }),
  };
}

test("planner: sandbox-output normalizes relative planner outputFile into session outputDir", async () => {
  const { config, cleanup } = makeConfig("relative-output");
  const runner: AgentRunner = async () => ({
    finalText: JSON.stringify({
      title: "Normalize Output",
      ambiguities: [],
      steps: [
        { id: "setup-vite-scaffold", title: "Setup Vite", specFragment: "Setup", description: "Write package.json", outputFile: "package.json", dependsOn: [], role: "implementation", acceptanceCriteria: "Create package.json" },
        { id: "app-main", title: "Main App", specFragment: "Main", description: "Write src/main.tsx", outputFile: "src/main.tsx", dependsOn: ["setup-vite-scaffold"], role: "implementation", acceptanceCriteria: "Create src/main.tsx" },
      ],
    }),
    toolExecutions: [],
    tokensUsed: 0,
  });

  try {
    const graph = await buildGraph("spec", config, runner);
    assert.ok(graph);
    const setup = graph!.nodes.get("setup-vite-scaffold");
    const main = graph!.nodes.get("app-main");
    assert.equal(setup?.outputs.files?.[0], ".shipyard/projects/proj-x/sessions/sess-y/output/package.json");
    assert.equal(main?.outputs.files?.[0], ".shipyard/projects/proj-x/sessions/sess-y/output/src/main.tsx");
  } finally {
    cleanup();
  }
});

test("planner: sandbox-output still rejects parent-directory traversal after normalization", async () => {
  const { config, cleanup } = makeConfig("relative-escape");
  const runner: AgentRunner = async () => ({
    finalText: JSON.stringify({
      title: "Bad Output",
      ambiguities: [],
      steps: [
        { id: "bad", title: "Bad", specFragment: "Bad", description: "Write ../escape.ts", outputFile: "../escape.ts", dependsOn: [], role: "implementation", acceptanceCriteria: "Do not allow" },
      ],
    }),
    toolExecutions: [],
    tokensUsed: 0,
  });

  try {
    const graph = await buildGraph("spec", config, runner);
    assert.equal(graph, null);
  } finally {
    cleanup();
  }
});
