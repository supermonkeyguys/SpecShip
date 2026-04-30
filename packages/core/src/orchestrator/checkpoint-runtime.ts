import * as fs from "fs";
import * as path from "path";
import type { ShipyardConfig } from "../config";
import type { Evidence, ExecutionGraph, GraphNode } from "../graph";
import { replaceGraphNodes } from "../graph";

/**
 * 在 checkpoint 节点暂停前，将决策摘要写入 .md 文件，
 * 供前端文件树展示。返回写入的绝对路径列表。
 */
export function writeCheckpointSummary(node: GraphNode, config: ShipyardConfig): string[] {
  const outputDir = config.outputDir ?? "output";
  const dirPath = path.join(config.workDir, outputDir);
  fs.mkdirSync(dirPath, { recursive: true });

  const fileName = `${node.id}-review.md`;
  const filePath = path.join(dirPath, fileName);

  const content = [
    `# Checkpoint: ${node.title}`,
    "",
    `> This is a human confirmation checkpoint. Execution is paused until you confirm.`,
    "",
    `## Decision Required`,
    "",
    node.inputs.description,
    "",
    `## Context`,
    "",
    node.specFragment ? `**Spec fragment:** ${node.specFragment}` : "",
    "",
    `**Node ID:** \`${node.id}\``,
    `**Depends on:** ${node.dependsOn.length ? node.dependsOn.join(", ") : "none"}`,
    "",
    `---`,
    `*Created at: ${new Date().toISOString()}*`,
  ].filter((l) => l !== undefined).join("\n");

  fs.writeFileSync(filePath, content, "utf-8");
  return [filePath];
}

export function buildCheckpointEvidence(node: GraphNode, summaryFiles: string[], workDir: string): Evidence {
  return {
    reasoning: node.inputs.description,
    promptUsed: "",
    modelUsed: "",
    toolCalls: [],
    filesWritten: summaryFiles.map((f) => ({
      path: path.relative(workDir, f),
      operation: "create" as const,
      sizeBytes: fs.existsSync(f) ? fs.statSync(f).size : 0,
      checksum: "",
      timestamp: new Date().toISOString(),
    })),
    verifications: [],
    startedAt: new Date().toISOString(),
    completedAt: "",
    durationMs: 0,
  };
}

export function pauseGraphAtCheckpoint(
  graph: ExecutionGraph,
  nodeId: string,
  evidence: Evidence
): ExecutionGraph {
  const node = graph.nodes.get(nodeId);
  if (!node) throw new Error(`Node not found: ${nodeId}`);

  const nodes = new Map(graph.nodes);
  nodes.set(nodeId, { ...node, evidence });
  return replaceGraphNodes(graph, nodes, { status: "paused" });
}

export function resumeGraphAfterCheckpointPause(graph: ExecutionGraph): ExecutionGraph {
  return { ...graph, status: "running", updatedAt: new Date().toISOString() };
}
