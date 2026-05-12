import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import { buildGraph } from "../../packages/core/src/orchestrator/planner";
import type { ShipyardConfig } from "../../packages/core/src/config";
import type { AgentRunner } from "../../packages/core/src/orchestrator/runtime-types";

function makeConfig(name: string): { config: ShipyardConfig; cleanup: () => void } {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `shipyard-planner-acceptance-${name}-`));
  return {
    config: {
      workDir,
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

test("planner: buildGraph preserves structured acceptance from planner output", async () => {
  const { config, cleanup } = makeConfig("structured-acceptance");
  const runner: AgentRunner = async () => ({
    finalText: JSON.stringify({
      title: "Structured Acceptance",
      ambiguities: [],
      steps: [
        {
          id: "impl-main",
          title: "Main",
          specFragment: "Main",
          description: "Write output/main.ts",
          outputFile: "output/main.ts",
          dependsOn: [],
          role: "implementation",
          acceptanceCriteria: "Must export requiredFn and include tests",
          acceptance: {
            summary: "main.ts exports requiredFn and has a colocated test",
            exports: ["requiredFn"],
            compileRequired: true,
            testsRequired: true,
            requiredFiles: ["main.ts", "main.test.ts"],
            forbiddenDependencies: ["left-pad"],
          },
        },
      ],
    }),
    toolExecutions: [],
    tokensUsed: 0,
  });

  try {
    const graph = await buildGraph("spec", config, runner);
    assert.ok(graph);
    const node = graph!.nodes.get("impl-main");
    assert.ok(node);
    assert.equal(node!.acceptance?.summary, "main.ts exports requiredFn and has a colocated test");
    assert.deepEqual(node!.acceptance?.exports, ["requiredFn"]);
    assert.equal(node!.acceptance?.testsRequired, true);
    assert.deepEqual(node!.acceptance?.requiredFiles, ["main.ts", "main.test.ts"]);
    assert.deepEqual(node!.acceptance?.forbiddenDependencies, ["left-pad"]);
  } finally {
    cleanup();
  }
});

test("planner: buildGraph normalizes partial acceptance with fallback summary", async () => {
  const { config, cleanup } = makeConfig("normalize-acceptance");
  const runner: AgentRunner = async () => ({
    finalText: JSON.stringify({
      title: "Normalize Acceptance",
      ambiguities: [],
      steps: [
        {
          id: "impl-main",
          title: "Main",
          specFragment: "Main",
          description: "Write output/main.ts",
          outputFile: "output/main.ts",
          dependsOn: [],
          role: "implementation",
          acceptanceCriteria: "Must compile cleanly",
          acceptance: {
            exports: ["requiredFn"],
            compileRequired: true
          },
        },
      ],
    }),
    toolExecutions: [],
    tokensUsed: 0,
  });

  try {
    const graph = await buildGraph("spec", config, runner);
    assert.ok(graph);
    const node = graph!.nodes.get("impl-main");
    assert.ok(node);
    assert.equal(node!.acceptance?.summary, "Must compile cleanly");
    assert.deepEqual(node!.acceptance?.exports, ["requiredFn"]);
    assert.equal(node!.acceptance?.compileRequired, true);
  } finally {
    cleanup();
  }
});
