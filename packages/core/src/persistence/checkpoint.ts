import * as fs from "fs";
import * as path from "path";
import { ExecutionGraph, GraphNode } from "../graph";
import { recalcGraphStats } from "../graph/graph-stats";

const CHECKPOINT_FILE = ".shipyard-graph.json";

type SerializedExecutionGraph = Omit<ExecutionGraph, "nodes"> & {
  nodes: Array<[string, GraphNode]> | Record<string, GraphNode>;
};

export function getCheckpointPath(workDir: string, sessionGraphPath?: string): string {
  if (sessionGraphPath) return sessionGraphPath;
  return path.join(workDir, CHECKPOINT_FILE);
}

export function saveGraphCheckpoint(workDir: string, graph: ExecutionGraph, sessionGraphPath?: string): string {
  const graphPath = getCheckpointPath(workDir, sessionGraphPath);
  const tmpPath = `${graphPath}.tmp-${process.pid}-${Date.now()}`;
  const serializable: SerializedExecutionGraph = {
    ...graph,
    nodes: Array.from(graph.nodes.entries()),
  };

  try {
    fs.writeFileSync(tmpPath, JSON.stringify(serializable, null, 2), "utf-8");
    fs.renameSync(tmpPath, graphPath);
  } catch (error) {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    throw error;
  }

  return graphPath;
}

export function loadGraphCheckpoint(workDir: string, sessionGraphPath?: string): ExecutionGraph {
  const graphPath = getCheckpointPath(workDir, sessionGraphPath);
  if (!fs.existsSync(graphPath)) {
    throw new Error(`Checkpoint not found: ${graphPath}`);
  }

  const raw = JSON.parse(fs.readFileSync(graphPath, "utf-8")) as Partial<SerializedExecutionGraph>;
  const nodes = deserializeNodes(raw.nodes);

  return {
    ...(raw as Omit<ExecutionGraph, "nodes" | "stats">),
    nodes,
    stats: recalcGraphStats(nodes),
  };
}

export function prepareGraphForResume(graph: ExecutionGraph): ExecutionGraph {
  const now = new Date().toISOString();
  let changed = false;
  const nodes = new Map<string, GraphNode>();

  for (const [nodeId, node] of graph.nodes.entries()) {
    if (node.status === "running" || node.status === "verifying") {
      nodes.set(nodeId, { ...node, status: "ready", updatedAt: now });
      changed = true;
    } else {
      nodes.set(nodeId, node);
    }
  }

  return {
    ...graph,
    status: "running",
    nodes,
    stats: recalcGraphStats(nodes),
    updatedAt: changed ? now : graph.updatedAt,
    completedAt: undefined,
  };
}

function deserializeNodes(rawNodes: unknown): Map<string, GraphNode> {
  if (Array.isArray(rawNodes)) {
    return new Map(rawNodes as Array<[string, GraphNode]>);
  }

  if (rawNodes && typeof rawNodes === "object") {
    return new Map(Object.entries(rawNodes as Record<string, GraphNode>));
  }

  return new Map<string, GraphNode>();
}

