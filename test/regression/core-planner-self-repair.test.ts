import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import { buildGraph } from "../../packages/core/src/orchestrator/planner";
import { reactAppStrategy } from "../../packages/core/src/strategies/react-app";
import type { ShipyardConfig } from "../../packages/core/src/config";
import type { AgentRunner } from "../../packages/core/src/orchestrator/runtime-types";

function makeConfig(name: string): { config: ShipyardConfig; cleanup: () => void } {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `shipyard-planner-repair-${name}-`));
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

test("planner: retries and repairs duplicate output files from planner", async () => {
  const { config, cleanup } = makeConfig("duplicate-files");
  let calls = 0;

  const runner: AgentRunner = async (_systemPrompt, userPrompt) => {
    calls += 1;
    if (calls === 1) {
      return {
        finalText: JSON.stringify({
          title: "Duplicate Files",
          ambiguities: [],
          steps: [
            { id: "index-a", title: "Index A", specFragment: "A", description: "Write index", outputFile: "index.html", dependsOn: [], role: "implement", acceptanceCriteria: "Create index" },
            { id: "index-b", title: "Index B", specFragment: "B", description: "Write index again", outputFile: "index.html", dependsOn: ["index-a"], role: "implement", acceptanceCriteria: "Do not duplicate index" },
          ],
        }),
        toolExecutions: [],
        tokensUsed: 0,
      };
    }

    assert.match(userPrompt, /Duplicate files: .+index\.html/);
    return {
      finalText: JSON.stringify({
        title: "Duplicate Files Fixed",
        ambiguities: [],
        steps: [
          { id: "index", title: "Index", specFragment: "A", description: "Write index", outputFile: "index.html", dependsOn: [], role: "implement", acceptanceCriteria: "Create index" },
          { id: "app", title: "App", specFragment: "B", description: "Write app", outputFile: "src/App.tsx", dependsOn: ["index"], role: "implement", acceptanceCriteria: "Create app" },
        ],
      }),
      toolExecutions: [],
      tokensUsed: 0,
    };
  };

  try {
    const graph = await buildGraph("build a react app", config, runner, undefined, reactAppStrategy);
    assert.ok(graph);
    assert.equal(calls, 2);
    assert.equal(graph!.nodes.get("index")?.outputs.files?.[0], ".shipyard/projects/proj-x/sessions/sess-y/output/index.html");
    assert.equal(graph!.nodes.get("app")?.outputs.files?.[0], ".shipyard/projects/proj-x/sessions/sess-y/output/src/App.tsx");
  } finally {
    cleanup();
  }
});
