import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import { buildGraph } from "../../packages/core/src/orchestrator/planner";
import { run } from "../../packages/core/src/orchestrator/shipyard";
import type { ShipyardConfig } from "../../packages/core/src/config";
import type { AgentRunner } from "../../packages/core/src/orchestrator/runtime-types";
import { makeMockNodeVerifier } from "./helpers";

function makeRepoEditConfig(name: string, policy?: { allowedWriteGlobs?: string[]; forbiddenPaths?: string[] }): { config: ShipyardConfig; cleanup: () => void } {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `shipyard-repo-edit-${name}-`));
  fs.mkdirSync(path.join(workDir, "src"), { recursive: true });
  return {
    config: {
      workDir,
      repoPath: workDir,
      executionMode: "repo-edit",
      workspacePolicy: policy,
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

test("repo-edit: buildGraph fails when workspacePolicy.allowedWriteGlobs is missing", async () => {
  const { config, cleanup } = makeRepoEditConfig("missing-policy");
  const planner: AgentRunner = async () => ({
    finalText: JSON.stringify({
      title: "Repo Edit",
      ambiguities: [],
      steps: [{ id: "impl-main", title: "Main", specFragment: "Main", description: "Write src/main.ts", outputFile: "src/main.ts", dependsOn: [], role: "implementation" }],
    }),
    toolExecutions: [],
    tokensUsed: 0,
  });

  try {
    const graph = await buildGraph("edit repo", config, planner);
    assert.equal(graph, null);
  } finally {
    cleanup();
  }
});

test("repo-edit: buildGraph rejects paths outside allowed write globs", async () => {
  const { config, cleanup } = makeRepoEditConfig("disallowed-path", { allowedWriteGlobs: ["src/**"] });
  const planner: AgentRunner = async () => ({
    finalText: JSON.stringify({
      title: "Repo Edit",
      ambiguities: [],
      steps: [{ id: "impl-main", title: "Main", specFragment: "Main", description: "Write package.json", outputFile: "package.json", dependsOn: [], role: "implementation" }],
    }),
    toolExecutions: [],
    tokensUsed: 0,
  });

  try {
    const graph = await buildGraph("edit repo", config, planner);
    assert.equal(graph, null);
  } finally {
    cleanup();
  }
});

test("repo-edit: run succeeds for writes inside allowed policy scope", async () => {
  const { config, cleanup } = makeRepoEditConfig("allowed-run", { allowedWriteGlobs: ["src/**"], forbiddenPaths: ["src/secret/**"] });

  const agentRunner: AgentRunner = async (systemPrompt, userPrompt, workDir, _cfg, _withTools, onToolCall) => {
    if (systemPrompt.includes("architect") || systemPrompt.includes("implementation plan")) {
      return {
        finalText: JSON.stringify({
          title: "Repo Edit",
          ambiguities: [],
          steps: [{ id: "impl-main", title: "Main", specFragment: "Main", description: "Write src/main.ts", outputFile: "src/main.ts", dependsOn: [], role: "implementation" }],
        }),
        toolExecutions: [],
        tokensUsed: 0,
      };
    }

    if (systemPrompt.includes("code reviewer")) {
      return { finalText: JSON.stringify({ passed: true, blocking: [], warnings: [], summary: "ok" }), toolExecutions: [], tokensUsed: 0 };
    }

    const targetFile = "src/main.ts";
    const content = 'export const repoEdit = true;\n';
    fs.writeFileSync(path.join(workDir, targetFile), content);
    const execution = { tool: "write_file", input: { path: targetFile, content }, output: `Written: ${targetFile}`, success: true, filePath: targetFile };
    onToolCall?.(execution as never);
    return { finalText: "", toolExecutions: [execution], tokensUsed: 0 };
  };

  try {
    const graph = await run("edit repo", config, undefined, undefined, agentRunner, makeMockNodeVerifier());
    assert.equal(graph.status, "done");
    assert.ok(fs.existsSync(path.join(config.workDir, "src/main.ts")));
  } finally {
    cleanup();
  }
});

test("repo-edit: run fails when implementer writes outside allowed policy scope", async () => {
  const { config, cleanup } = makeRepoEditConfig("outside-run", { allowedWriteGlobs: ["src/**"] });

  const agentRunner: AgentRunner = async (systemPrompt, _userPrompt, workDir, _cfg, _withTools, onToolCall) => {
    if (systemPrompt.includes("architect") || systemPrompt.includes("implementation plan")) {
      return {
        finalText: JSON.stringify({
          title: "Repo Edit",
          ambiguities: [],
          steps: [{ id: "impl-main", title: "Main", specFragment: "Main", description: "Write src/main.ts", outputFile: "src/main.ts", dependsOn: [], role: "implementation" }],
        }),
        toolExecutions: [],
        tokensUsed: 0,
      };
    }

    const badPath = "package.json";
    const content = '{"name":"bad"}';
    fs.writeFileSync(path.join(workDir, badPath), content);
    const execution = { tool: "write_file", input: { path: badPath, content }, output: `Written: ${badPath}`, success: true, filePath: badPath };
    onToolCall?.(execution as never);
    return { finalText: "", toolExecutions: [execution], tokensUsed: 0 };
  };

  try {
    const graph = await run("edit repo", config, undefined, undefined, agentRunner, makeMockNodeVerifier());
    assert.equal(graph.status, "failed");
  } finally {
    cleanup();
  }
});
