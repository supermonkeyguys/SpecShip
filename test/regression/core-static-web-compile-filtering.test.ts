import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import { verifyNode } from "../../packages/core/src/verification/verify";
import { run } from "../../packages/core/src/orchestrator/shipyard";
import { staticWebStrategy } from "../../packages/core/src/strategies/static-web";
import type { ShipyardConfig } from "../../packages/core/src/config";
import type { AgentRunner, NodeVerifier } from "../../packages/core/src/orchestrator/shipyard";

function makeConfig(name: string): { config: ShipyardConfig; cleanup: () => void } {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `shipyard-static-web-compile-${name}-`));
  return {
    config: {
      workDir,
      maxRetries: 1,
      baseURL: "http://mock",
      apiKey: "mock",
      models: {
        clarifier: "mock",
        planner: "mock",
        implementer: "mock",
        reviewer: "mock",
        tester: "mock",
        integrator: "mock",
        utility: "mock",
        planning: "mock",
        implementation: "mock",
        review: "mock",
      },
    },
    cleanup: () => fs.rmSync(workDir, { recursive: true, force: true }),
  };
}

test("verify: static-web html file does not fail TypeScript compile check", async () => {
  const { config, cleanup } = makeConfig("html-only");
  try {
    const file = path.join(config.workDir, "output", "index.html");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "<!doctype html><html><body><h1>Hello</h1></body></html>\n");

    const result = await verifyNode("Create landing page", [file], config.workDir, config, "implementer", staticWebStrategy);
    assert.equal(result.passed, true);
    assert.match(result.summary, /asset-only|Structural checks passed/i);
    assert.equal(result.records[0]?.type, "compile");
    assert.equal(result.records[0]?.passed, true);
  } finally {
    cleanup();
  }
});

test("run: static-web session with html/css/js outputs passes without tsc-on-html failure", async () => {
  const { config, cleanup } = makeConfig("run-static-web");

  const agentRunner: AgentRunner = async (systemPrompt, _userPrompt, workDir, _cfg, _withTools, onToolCall) => {
    if (systemPrompt.includes("planning agent for static website")) {
      return {
        finalText: JSON.stringify({
          title: "Static Site",
          ambiguities: [],
          steps: [
            { id: "create-index-html", title: "Create index", specFragment: "index", description: "Write index.html", outputFile: "index.html", dependsOn: [], role: "implement", acceptanceCriteria: "Create html" },
            { id: "create-styles", title: "Create styles", specFragment: "styles", description: "Write styles.css", outputFile: "styles.css", dependsOn: ["create-index-html"], role: "implement", acceptanceCriteria: "Create css" },
            { id: "create-app-js", title: "Create app", specFragment: "app", description: "Write app.js", outputFile: "app.js", dependsOn: ["create-index-html"], role: "implement", acceptanceCriteria: "Create js" },
          ],
        }),
        toolExecutions: [],
        tokensUsed: 0,
      };
    }

    if (systemPrompt.includes("code reviewer")) {
      return {
        finalText: JSON.stringify({ passed: true, blocking: [], warnings: [], summary: "ok" }),
        toolExecutions: [],
        tokensUsed: 0,
      };
    }

    const mapping: Record<string, string> = {
      "index.html": "<!doctype html><html><body><div id=\"app\"></div><script src=\"./app.js\"></script></body></html>\n",
      "styles.css": "body { font-family: sans-serif; }\n",
      "app.js": "document.getElementById('app').textContent = 'hello';\n",
    };

    const outputFileMatch = systemPrompt.match(/Output file: (\S+)/) || _userPrompt.match(/Output file: (\S+)/);
    const targetFile = outputFileMatch?.[1] ?? "output/index.html";
    const basename = path.basename(targetFile);
    const content = mapping[basename] ?? "";
    const fullPath = path.resolve(workDir, targetFile);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, "utf-8");
    const execution = { tool: "write_file", input: { path: targetFile, content }, output: "Written", success: true, filePath: targetFile };
    onToolCall?.(execution);
    return { finalText: "", toolExecutions: [execution], tokensUsed: 0 };
  };

  const verifier: NodeVerifier = verifyNode;

  try {
    const graph = await run("Build a static website landing page", config, undefined, undefined, agentRunner, verifier, undefined, undefined, staticWebStrategy);
    assert.equal(graph.status, "done");
  } finally {
    cleanup();
  }
});
