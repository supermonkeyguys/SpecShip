import * as fs from "fs";
import * as path from "path";
import { addNode, type ExecutionGraph, type GraphNode } from "../graph";
import type { TaskStrategy } from "../strategies/base";

function isTestFile(file: string): boolean {
  return file.includes(".test.") || file.includes(".spec.");
}

function expectedTestOutputs(outputFile: string): string[] {
  if (outputFile.endsWith(".tsx")) {
    const base = outputFile.replace(/\.tsx$/, "");
    return [`${base}.test.tsx`, `${base}.spec.tsx`, `${base}.test.ts`, `${base}.spec.ts`];
  }
  if (outputFile.endsWith(".ts")) {
    const base = outputFile.replace(/\.ts$/, "");
    return [`${base}.test.ts`, `${base}.spec.ts`];
  }
  if (outputFile.endsWith(".js")) {
    const base = outputFile.replace(/\.js$/, "");
    return [`${base}.test.js`, `${base}.spec.js`];
  }
  return [];
}

function shouldCreateTesterNode(node: GraphNode, graph: ExecutionGraph, workDir: string, strategyId: string): boolean {
  if (node.type !== "implement") return false;
  if (node.nodeRole !== "implementer") return false;
  if (node.status !== "done") return false;

  const outputFile = node.outputs.files?.[0];
  if (!outputFile) return false;
  if (isTestFile(outputFile)) return false;
  if (!(outputFile.endsWith(".ts") || outputFile.endsWith(".tsx") || outputFile.endsWith(".js"))) return false;

  const normalized = outputFile.replace(/\\/g, "/");
  const baseName = path.basename(normalized);
  if (["vite.config.ts", "tsconfig.json", "package.json", "index.html"].includes(baseName)) return false;

  if (strategyId === "react-app") {
    const lower = normalized.toLowerCase();
    const isEntryFile = lower.endsWith("/main.tsx") || lower.endsWith("/main.ts") || lower.endsWith("/app.tsx");
    const isLikelyTestableUi = lower.includes("/components/") || lower.includes("/hooks/") || lower.includes("/store/") || lower.includes("/state/") || lower.includes("/utils/");
    if (isEntryFile) return false;
    if (!isLikelyTestableUi) return false;
  }

  const implPath = path.resolve(workDir, outputFile);
  if (!fs.existsSync(implPath)) return false;

  const existingOutputs = new Set(Array.from(graph.nodes.values()).flatMap((n) => n.outputs.files ?? []));
  const candidates = expectedTestOutputs(outputFile);
  if (candidates.some((candidate) => existingOutputs.has(candidate) || fs.existsSync(path.resolve(workDir, candidate)))) {
    return false;
  }

  return true;
}

export function appendDeferredTesterNodes(graph: ExecutionGraph, workDir: string, strategy?: TaskStrategy): { graph: ExecutionGraph; added: string[] } {
  let nextGraph = graph;
  const added: string[] = [];

  const strategyId = strategy?.id ?? "typescript-lib";

  for (const node of Array.from(graph.nodes.values())) {
    if (!shouldCreateTesterNode(node, graph, workDir, strategyId)) continue;

    const outputFile = node.outputs.files?.[0];
    if (!outputFile) continue;
    const [preferredTestFile] = expectedTestOutputs(outputFile);
    if (!preferredTestFile) continue;

    const testerNodeId = `test-${node.id}`;
    if (nextGraph.nodes.has(testerNodeId)) continue;

    nextGraph = addNode(nextGraph, {
      id: testerNodeId,
      type: "implement",
      title: `Test ${node.title}`,
      specFragment: `Add focused tests for ${outputFile}`,
      nodeRole: "tester",
      task: `Write a focused test file for ${outputFile}. Test the main exported behavior, the happy path, and 1-2 important edge cases. Keep the implementation file unchanged unless absolutely necessary for testability.`,
      acceptanceCriteria: `Create ${preferredTestFile}. The test must import from ${outputFile} using a relative path without file extension and pass in the dedicated tester verification environment.`,
      skills: ["deferred-testing"],
      dependsOn: [node.id],
      inputs: { description: `Existing implementation in ${outputFile} is complete and should now receive a focused test file.`, files: [outputFile] },
      outputs: {
        description: `Write ${preferredTestFile}`,
        files: [preferredTestFile],
        verificationCriteria: [],
      },
      status: "ready",
      maxRetries: 1,
    });
    added.push(testerNodeId);
  }

  return { graph: nextGraph, added };
}
