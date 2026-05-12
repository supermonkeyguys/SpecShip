import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import { verifyNode } from "../../packages/core/src/verification/verify";
import type { ShipyardConfig } from "../../packages/core/src/config";
import { runCodeReview } from "../../packages/core/src/orchestrator/review";
import type { GraphNode } from "../../packages/core/src/graph";
import type { AgentRunner } from "../../packages/core/src/orchestrator/runtime-types";

function makeConfig(name: string): { config: ShipyardConfig; cleanup: () => void } {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `shipyard-acceptance-${name}-`));
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

test("acceptance: verifyNode fails when required exports are missing", async () => {
  const { config, cleanup } = makeConfig("missing-exports");
  try {
    const file = path.join(config.workDir, "output/main.ts");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'export const present = true;\n');

    const acceptance = { summary: "must export required symbol", exports: ["missingFn"], compileRequired: true };
    const result = await verifyNode("Implement main", [file], config.workDir, config, "implementer", undefined, acceptance);
    assert.equal(result.passed, false);
    assert.match(result.summary, /failed/i);
    assert.ok(result.records.some((r) => r.type === "spec_check" && /Missing required exports/.test(r.output)));
  } finally {
    cleanup();
  }
});

test("acceptance: verifyNode passes when required exports exist", async () => {
  const { config, cleanup } = makeConfig("present-exports");
  try {
    const file = path.join(config.workDir, "output/main.ts");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'export function requiredFn(): string { return "ok"; }\n');

    const acceptance = { summary: "must export required symbol", exports: ["requiredFn"], compileRequired: true };
    const result = await verifyNode("Implement main", [file], config.workDir, config, "implementer", undefined, acceptance);
    assert.equal(result.passed, true);
    assert.ok(result.records.some((r) => r.type === "spec_check" && /Required exports present/.test(r.output)));
  } finally {
    cleanup();
  }
});

test("acceptance: verifyNode fails when testsRequired but no test file exists", async () => {
  const { config, cleanup } = makeConfig("tests-required");
  try {
    const file = path.join(config.workDir, "output/main.ts");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'export function requiredFn(): string { return "ok"; }\n');

    const acceptance = { summary: "tests required", testsRequired: true, compileRequired: true };
    const result = await verifyNode("Implement main", [file], config.workDir, config, "implementer", undefined, acceptance);
    assert.equal(result.passed, false);
    assert.ok(result.records.some((r) => r.type === "spec_check" && /requires a colocated test/.test(r.output)));
  } finally {
    cleanup();
  }
});

test("acceptance: reviewer prompt includes structured acceptance details", async () => {
  const { config, cleanup } = makeConfig("reviewer-structured");
  try {
    const file = path.join(config.workDir, "output/main.ts");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'export function requiredFn(): string { return "ok"; }\n');

    let capturedUserPrompt = "";
    const agentRunner: AgentRunner = async (_systemPrompt, userPrompt) => {
      capturedUserPrompt = userPrompt;
      return { finalText: JSON.stringify({ passed: true, blocking: [], warnings: [], summary: "ok" }), toolExecutions: [], tokensUsed: 0 };
    };

    const node = {
      id: "impl-main",
      type: "implement",
      title: "Main",
      specFragment: "Main",
      nodeRole: "implementer",
      task: "Implement main",
      acceptanceCriteria: "Must compile",
      acceptance: { summary: "must export requiredFn", exports: ["requiredFn"], testsRequired: false },
      skills: [],
      dependsOn: [],
      inputs: { description: "desc" },
      outputs: { description: "out", files: ["output/main.ts"], verificationCriteria: [] },
      status: "done",
      retryCount: 0,
      maxRetries: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } satisfies GraphNode;

    const result = await runCodeReview(node, [file], config, agentRunner);
    assert.equal(result.passed, true);
    assert.match(capturedUserPrompt, /Structured acceptance summary/);
    assert.match(capturedUserPrompt, /Required exports: requiredFn/);
  } finally {
    cleanup();
  }
});


test("acceptance: verifyNode fails when requiredFiles are missing", async () => {
  const { config, cleanup } = makeConfig("required-files");
  try {
    const file = path.join(config.workDir, "output/main.ts");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'export function requiredFn(): string { return "ok"; }\n');

    const acceptance = { summary: "must include extra file", requiredFiles: ["main.ts", "main.test.ts"], compileRequired: true };
    const result = await verifyNode("Implement main", [file], config.workDir, config, "implementer", undefined, acceptance);
    assert.equal(result.passed, false);
    assert.ok(result.records.some((r) => r.type === "spec_check" && /Missing required files/.test(r.output)));
  } finally {
    cleanup();
  }
});

test("acceptance: verifyNode fails when forbiddenDependencies are present", async () => {
  const { config, cleanup } = makeConfig("forbidden-deps");
  try {
    const file = path.join(config.workDir, "output/main.ts");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'import leftPad from "left-pad";\nexport const ok = leftPad("x", 2);\n');

    const acceptance = { summary: "must not use forbidden deps", forbiddenDependencies: ["left-pad"], compileRequired: false };
    const result = await verifyNode("Implement main", [file], config.workDir, config, "implementer", undefined, acceptance);
    assert.equal(result.passed, false);
    assert.ok(result.records.some((r) => r.type === "spec_check" && /Forbidden dependencies detected/.test(r.output)));
  } finally {
    cleanup();
  }
});

test("acceptance: verifyNode can skip compile when compileRequired is false", async () => {
  const { config, cleanup } = makeConfig("skip-compile");
  try {
    const file = path.join(config.workDir, "output/main.ts");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'export const broken: number = "oops" as unknown as number;\n');

    const acceptance = { summary: "compile optional", compileRequired: false };
    const result = await verifyNode("Implement main", [file], config.workDir, config, "implementer", undefined, acceptance);
    assert.equal(result.passed, true);
    assert.ok(result.records.some((r) => r.type === "compile" && /skipped by structured acceptance/.test(r.output)));
  } finally {
    cleanup();
  }
});
