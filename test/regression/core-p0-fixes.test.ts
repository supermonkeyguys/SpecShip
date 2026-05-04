import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import { buildGraph, run } from "../../packages/core/src/orchestrator/shipyard";
import { verifyNode } from "../../packages/core/src/verification/verify";
import type { ShipyardConfig } from "../../packages/core/src/config";
import type { AgentRunner, NodeVerifier } from "../../packages/core/src/orchestrator/shipyard";

function makeConfig(name: string): { config: ShipyardConfig; cleanup: () => void } {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `shipyard-core-${name}-`));
  return {
    config: {
      workDir,
      maxRetries: 1,
      baseURL: "http://mock",
      apiKey: "mock",
      models: {
        planning: "mock",
        implementation: "mock",
        review: "mock",
      },
    },
    cleanup: () => fs.rmSync(workDir, { recursive: true, force: true }),
  };
}

test("core: buildGraph rejects duplicate step ids, cycles, and output paths outside outputDir", async () => {
  const { config, cleanup } = makeConfig("planner-guards");

  try {
    const duplicateIdRunner: AgentRunner = async (systemPrompt) => {
      if (systemPrompt.includes("architect")) {
        return {
          finalText: JSON.stringify({
            title: "dup-id",
            ambiguities: [],
            steps: [
              { id: "a", title: "A1", specFragment: "A1", description: "A1", outputFile: "output/a.ts", dependsOn: [], role: "implementation" },
              { id: "a", title: "A2", specFragment: "A2", description: "A2", outputFile: "output/b.ts", dependsOn: [], role: "implementation" },
            ],
          }),
          toolExecutions: [],
          tokensUsed: 0,
        };
      }
      return { finalText: "", toolExecutions: [], tokensUsed: 0 };
    };
    assert.equal(await buildGraph("x", config, duplicateIdRunner), null);

    const cycleRunner: AgentRunner = async (systemPrompt) => {
      if (systemPrompt.includes("architect")) {
        return {
          finalText: JSON.stringify({
            title: "cycle",
            ambiguities: [],
            steps: [
              { id: "a", title: "A", specFragment: "A", description: "A", outputFile: "output/a.ts", dependsOn: ["b"], role: "implementation" },
              { id: "b", title: "B", specFragment: "B", description: "B", outputFile: "output/b.ts", dependsOn: ["a"], role: "implementation" },
            ],
          }),
          toolExecutions: [],
          tokensUsed: 0,
        };
      }
      return { finalText: "", toolExecutions: [], tokensUsed: 0 };
    };
    assert.equal(await buildGraph("x", config, cycleRunner), null);

    const outsideOutputRunner: AgentRunner = async (systemPrompt) => {
      if (systemPrompt.includes("architect")) {
        return {
          finalText: JSON.stringify({
            title: "bad-output",
            ambiguities: [],
            steps: [
              { id: "a", title: "A", specFragment: "A", description: "A", outputFile: "../escape.ts", dependsOn: [], role: "implementation" },
            ],
          }),
          toolExecutions: [],
          tokensUsed: 0,
        };
      }
      return { finalText: "", toolExecutions: [], tokensUsed: 0 };
    };
    assert.equal(await buildGraph("x", config, outsideOutputRunner), null);
  } finally {
    cleanup();
  }
});

test("core: review failure exhausts retries and leaves node failed", async () => {
  const { config, cleanup } = makeConfig("review-failure");

  try {
    const agentRunner: AgentRunner = async (systemPrompt, userPrompt, workDir, _cfg, _withTools, onToolCall) => {
      if (systemPrompt.includes("architect")) {
        return {
          finalText: JSON.stringify({
            title: "review-fail",
            ambiguities: [],
            steps: [
              { id: "impl-main", title: "Main", specFragment: "Main", description: "Write output/main.ts", outputFile: "output/main.ts", dependsOn: [], role: "implementation" },
            ],
          }),
          toolExecutions: [],
          tokensUsed: 0,
        };
      }

      if (systemPrompt.includes("strict code reviewer")) {
        return {
          finalText: JSON.stringify({ passed: false, blocking: ["bad review"], warnings: [], summary: "no" }),
          toolExecutions: [],
          tokensUsed: 0,
        };
      }

      const fileMatch = userPrompt.match(/Output file: (\S+)/);
      const targetFile = fileMatch?.[1] ?? "output/main.ts";
      fs.mkdirSync(path.dirname(path.join(workDir, targetFile)), { recursive: true });
      const content = 'export function main(): string { return "ok"; }\n';
      fs.writeFileSync(path.join(workDir, targetFile), content);
      const execution = { tool: "write_file", input: { path: targetFile, content }, output: "Written", success: true, filePath: targetFile };
      onToolCall?.(execution);
      return { finalText: "", toolExecutions: [execution], tokensUsed: 0 };
    };

    const verifier: NodeVerifier = async () => ({
      passed: true,
      records: [{ type: "compile", passed: true, output: "ok", durationMs: 0, timestamp: new Date().toISOString() }],
      summary: "ok",
    });

    const graph = await run("spec", config, undefined, undefined, agentRunner, verifier);
    assert.equal(graph.status, "failed");
    const node = Array.from(graph.nodes.values())[0];
    assert.equal(node.status, "failed");
    assert.match(node.error?.message ?? "", /Code review failed/);
  } finally {
    cleanup();
  }
});

test("core: unexpected write path fails node instead of silently succeeding", async () => {
  const { config, cleanup } = makeConfig("write-boundary");

  try {
    const agentRunner: AgentRunner = async (systemPrompt, _userPrompt, workDir, _cfg, _withTools, onToolCall) => {
      if (systemPrompt.includes("architect")) {
        return {
          finalText: JSON.stringify({
            title: "write-boundary",
            ambiguities: [],
            steps: [
              { id: "impl-main", title: "Main", specFragment: "Main", description: "Write output/main.ts", outputFile: "output/main.ts", dependsOn: [], role: "implementation" },
            ],
          }),
          toolExecutions: [],
          tokensUsed: 0,
        };
      }

      const badPath = "output/../../escape.ts";
      fs.writeFileSync(path.join(workDir, "escape.ts"), "oops\n");
      const execution = { tool: "write_file", input: { path: badPath, content: "oops\n" }, output: "Written", success: true, filePath: badPath };
      onToolCall?.(execution);
      return { finalText: "", toolExecutions: [execution], tokensUsed: 0 };
    };

    const verifier: NodeVerifier = async () => ({
      passed: true,
      records: [{ type: "compile", passed: true, output: "ok", durationMs: 0, timestamp: new Date().toISOString() }],
      summary: "ok",
    });

    const graph = await run("spec", config, undefined, undefined, agentRunner, verifier);
    assert.equal(graph.status, "failed");
    const node = Array.from(graph.nodes.values())[0];
    assert.equal(node.status, "failed");
    assert.match(node.error?.message ?? "", /unexpected path/);
  } finally {
    cleanup();
  }
});

test("core: write path matcher accepts slash variants for same output file", async () => {
  const { config, cleanup } = makeConfig("write-slash-variant");

  try {
    const agentRunner: AgentRunner = async (systemPrompt, _userPrompt, workDir, _cfg, _withTools, onToolCall) => {
      if (systemPrompt.includes("architect")) {
        return {
          finalText: JSON.stringify({
            title: "write-slash-variant",
            ambiguities: [],
            steps: [
              { id: "impl-main", title: "Main", specFragment: "Main", description: "Write output/main.ts", outputFile: "output\\main.ts", dependsOn: [], role: "implementation" },
            ],
          }),
          toolExecutions: [],
          tokensUsed: 0,
        };
      }

      if (systemPrompt.includes("strict code reviewer")) {
        return {
          finalText: JSON.stringify({ passed: true, blocking: [], warnings: [], summary: "ok" }),
          toolExecutions: [],
          tokensUsed: 0,
        };
      }

      const actualPath = "output/main.ts";
      fs.mkdirSync(path.dirname(path.join(workDir, actualPath)), { recursive: true });
      const content = 'export function main(): string { return "ok"; }\n';
      fs.writeFileSync(path.join(workDir, actualPath), content);
      const execution = { tool: "write_file", input: { path: actualPath, content }, output: "Written", success: true, filePath: actualPath };
      onToolCall?.(execution);
      return { finalText: "", toolExecutions: [execution], tokensUsed: 0 };
    };

    const verifier: NodeVerifier = async () => ({
      passed: true,
      records: [{ type: "compile", passed: true, output: "ok", durationMs: 0, timestamp: new Date().toISOString() }],
      summary: "ok",
    });

    const graph = await run("spec", config, undefined, undefined, agentRunner, verifier);
    assert.equal(graph.status, "done");
    const node = Array.from(graph.nodes.values())[0];
    assert.equal(node.status, "done");
  } finally {
    cleanup();
  }
});

test("core: lint soft-failure does not block verifyNode success", async () => {
  const { config, cleanup } = makeConfig("lint-soft");
  const originalPath = process.env.PATH ?? "";
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipyard-bin-"));

  try {
    fs.writeFileSync(path.join(config.workDir, "eslint.config.js"), "module.exports = [];\n");
    const sampleFile = path.join(config.workDir, "sample.ts");
    fs.writeFileSync(sampleFile, 'export function sample(): string { return "ok"; }\n');

    const npxPath = path.join(binDir, "npx");
    fs.writeFileSync(
      npxPath,
      '#!/bin/sh\nif [ "$1" = "tsc" ]; then\n  exit 0\nfi\nif [ "$1" = "eslint" ]; then\n  echo "mock lint failure" 1>&2\n  exit 1\nfi\nexit 1\n',
      { mode: 0o755 }
    );
    process.env.PATH = `${binDir}:${originalPath}`;

    const result = await verifyNode("Implement sample", [sampleFile], config.workDir, config);
    assert.equal(result.passed, true);
    assert.match(result.summary, /soft check/);
    const lintRecord = result.records.find((record) => record.type === "lint");
    assert.equal(lintRecord?.passed, false);
  } finally {
    process.env.PATH = originalPath;
    fs.rmSync(binDir, { recursive: true, force: true });
    cleanup();
  }
});
