import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import { buildGraph } from "../../packages/core/src/orchestrator/planner";
import { executeNode } from "../../packages/core/src/orchestrator/node-executor";
import { createGraph, addNode } from "../../packages/core/src/graph";
import type { ShipyardConfig } from "../../packages/core/src/config";
import type { AgentRunner } from "../../packages/core/src/orchestrator/runtime-types";
import { routeModel } from "../../packages/core/src/orchestrator/model-router";
import { reactAppStrategy, typescriptLibStrategy } from "../../packages/core/src/strategies";

function makeConfig(name: string): { config: ShipyardConfig; cleanup: () => void } {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `shipyard-phase1-${name}-`));
  return {
    config: {
      workDir,
      maxRetries: 2,
      baseURL: "http://mock",
      apiKey: "mock",
      models: {
        clarifier: "clarifier-model",
        planner: "planner-model",
        implementer: "implementer-model",
        reviewer: "reviewer-model",
        tester: "tester-model",
        integrator: "integrator-model",
        utility: "utility-model",
        planning: "planner-model",
        implementation: "implementer-model",
        review: "reviewer-model",
      },
    },
    cleanup: () => fs.rmSync(workDir, { recursive: true, force: true }),
  };
}

test("phase1: routeModel selects role-specific models and escalates retries", () => {
  const { config, cleanup } = makeConfig("route-model");
  try {
    assert.equal(routeModel(config, { phase: "clarify" }).model, "clarifier-model");
    assert.equal(routeModel(config, { phase: "plan" }).model, "planner-model");
    assert.equal(routeModel(config, { phase: "review" }).model, "reviewer-model");
    assert.equal(routeModel(config, { phase: "execute", nodeRole: "implementer", retryCount: 0 }).model, "implementer-model");
    assert.equal(routeModel(config, { phase: "execute", nodeRole: "tester", retryCount: 0 }).model, "tester-model");
    assert.equal(routeModel(config, { phase: "execute", nodeRole: "integrator", retryCount: 0 }).model, "integrator-model");
    assert.equal(routeModel(config, { phase: "execute", nodeRole: "utility", retryCount: 0 }).model, "utility-model");
    assert.equal(routeModel(config, { phase: "execute", nodeRole: "implementer", retryCount: 1 }).model, "integrator-model");
  } finally {
    cleanup();
  }
});

test("phase1: buildGraph rejects output extensions not allowed by strategy", async () => {
  const { config, cleanup } = makeConfig("ext-guard");

  const badPlanner: AgentRunner = async () => ({
    finalText: JSON.stringify({
      title: "Bad ext",
      ambiguities: [],
      steps: [
        {
          id: "impl-main",
          title: "Main",
          specFragment: "Main",
          description: "Write output/main.py",
          outputFile: "output/main.py",
          dependsOn: [],
          role: "implementation",
        },
      ],
    }),
    toolExecutions: [],
    tokensUsed: 0,
  });

  try {
    const graph = await buildGraph("Build a TS module", config, badPlanner, undefined, typescriptLibStrategy);
    assert.equal(graph, null);
  } finally {
    cleanup();
  }
});

test("phase1: executeNode passes strategy allowedCommands into tool runtime", async () => {
  const { config, cleanup } = makeConfig("allowed-commands");

  let graph = createGraph("spec");
  graph = addNode(graph, {
    id: "impl-main",
    type: "implement",
    title: "Main",
    specFragment: "Main",
    nodeRole: "implementer",
    task: "Write output/main.ts and run npm install",
    acceptanceCriteria: "Create output/main.ts",
    skills: [],
    dependsOn: [],
    inputs: { description: "Write output/main.ts" },
    outputs: { description: "Write output/main.ts", files: ["output/main.ts"], verificationCriteria: [] },
    status: "ready",
    maxRetries: 1,
  });

  const agentRunner: AgentRunner = async (_systemPrompt, _userPrompt, workDir, _cfg, _withTools, onToolCall) => {
    const targetFile = "output/main.ts";
    fs.mkdirSync(path.join(workDir, "output"), { recursive: true });
    fs.writeFileSync(path.join(workDir, targetFile), 'export const ok = true;\n');

    const commandExecution = {
      tool: "run_command" as const,
      input: { command: "npm install" },
      output: "Blocked: only tsc/node/npm/npx commands allowed",
      success: false,
    };
    const writeExecution = {
      tool: "write_file" as const,
      input: { path: targetFile, content: 'export const ok = true;\n' },
      output: `Written: ${targetFile}`,
      success: true,
      filePath: targetFile,
    };

    onToolCall?.(commandExecution as never);
    onToolCall?.(writeExecution as never);

    return {
      finalText: "",
      toolExecutions: [commandExecution, writeExecution],
      tokensUsed: 0,
    };
  };

  try {
    const node = graph.nodes.get("impl-main");
    assert.ok(node);
    const result = await executeNode(node!, graph, config, agentRunner, undefined, undefined, reactAppStrategy);
    assert.ok(result.evidence.toolCalls.some((t) => t.tool === "run_command"));
    assert.equal(result.fatalError, undefined);
  } finally {
    cleanup();
  }
});


test("phase2: routeModel promotes high-complexity implementer nodes to integrator model", () => {
  const { config, cleanup } = makeConfig("phase2-high-complexity");
  try {
    const route = routeModel(config, {
      phase: "execute",
      nodeRole: "implementer",
      retryCount: 0,
      dependsOnCount: 4,
      dependencyContextChars: 14000,
    });

    assert.equal(route.model, "integrator-model");
    assert.equal(route.complexity, "high");
    assert.equal(route.risk, "high");
    assert.match(route.reason, /integrator model/);
  } finally {
    cleanup();
  }
});

test("phase2: routeModel keeps low-risk utility nodes on utility model", () => {
  const { config, cleanup } = makeConfig("phase2-utility-low-risk");
  try {
    const route = routeModel(config, {
      phase: "execute",
      nodeRole: "utility",
      retryCount: 0,
      dependsOnCount: 0,
      dependencyContextChars: 0,
    });

    assert.equal(route.model, "utility-model");
    assert.equal(route.complexity, "small");
    assert.equal(route.risk, "low");
  } finally {
    cleanup();
  }
});

test("phase2: executeNode evidence records route complexity and risk", async () => {
  const { config, cleanup } = makeConfig("phase2-evidence");

  let graph = createGraph("spec");
  graph = addNode(graph, {
    id: "impl-main",
    type: "implement",
    title: "Main",
    specFragment: "Main",
    nodeRole: "implementer",
    task: "Write output/main.ts",
    acceptanceCriteria: "Create output/main.ts",
    skills: [],
    dependsOn: [],
    inputs: { description: "Write output/main.ts" },
    outputs: { description: "Write output/main.ts", files: ["output/main.ts"], verificationCriteria: [] },
    status: "ready",
    maxRetries: 1,
  });

  const agentRunner: AgentRunner = async (_systemPrompt, _userPrompt, workDir, _cfg, _withTools, onToolCall) => {
    const targetFile = "output/main.ts";
    fs.mkdirSync(path.join(workDir, "output"), { recursive: true });
    const content = 'export const ok = true;\n';
    fs.writeFileSync(path.join(workDir, targetFile), content);
    const writeExecution = {
      tool: "write_file" as const,
      input: { path: targetFile, content },
      output: `Written: ${targetFile}`,
      success: true,
      filePath: targetFile,
    };
    onToolCall?.(writeExecution as never);
    return { finalText: "", toolExecutions: [writeExecution], tokensUsed: 0 };
  };

  try {
    const node = graph.nodes.get("impl-main");
    assert.ok(node);
    const result = await executeNode(node!, graph, config, agentRunner, undefined, undefined, typescriptLibStrategy);
    assert.equal(result.evidence.modelUsed, "implementer-model");
    assert.equal(result.evidence.modelRouteComplexity, "small");
    assert.equal(result.evidence.modelRouteRisk, "low");
    assert.match(result.evidence.modelRouteReason ?? "", /complexity=small/);
  } finally {
    cleanup();
  }
});
