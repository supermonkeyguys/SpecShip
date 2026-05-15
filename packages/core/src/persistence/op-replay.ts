import type {
  SessionOperationV1,
  SessionProjection,
  SessionProjectionNode,
  NodeStatus,
} from "../../../shared/src/types";

function ensureNode(projection: SessionProjection, nodeId: string): SessionProjectionNode {
  const existing = projection.nodes[nodeId];
  if (existing) return existing;

  const created: SessionProjectionNode = {
    id: nodeId,
    status: "pending",
    retryCount: 0,
    maxRetries: 0,
    filesWritten: [],
  };
  projection.nodes[nodeId] = created;
  return created;
}

function asNodeStatus(value: unknown): NodeStatus["status"] | undefined {
  if (
    value === "pending" ||
    value === "ready" ||
    value === "running" ||
    value === "verifying" ||
    value === "done" ||
    value === "failed" ||
    value === "blocked" ||
    value === "skipped"
  ) {
    return value;
  }
  return undefined;
}

function asGraphStatus(value: unknown): SessionProjection["graph"]["status"] {
  if (value === "building" || value === "running" || value === "paused" || value === "done" || value === "failed") {
    return value;
  }
  return undefined;
}

function asSessionStatus(value: unknown): SessionProjection["sessionStatus"] {
  if (value === "running" || value === "paused" || value === "done" || value === "failed" || value === "interrupted") {
    return value;
  }
  return undefined;
}

export function createEmptySessionProjection(projectId: string, sessionId: string): SessionProjection {
  return {
    projectId,
    sessionId,
    revision: 0,
    graph: {},
    nodes: {},
  };
}

export function replaySessionOperations(operations: SessionOperationV1[]): SessionProjection {
  if (operations.length === 0) {
    return createEmptySessionProjection("", "");
  }

  const first = operations[0]!;
  const projection = createEmptySessionProjection(first.projectId, first.sessionId);
  const seen = new Set<string>();

  for (const op of operations) {
    if (seen.has(op.opId)) continue;
    seen.add(op.opId);

    projection.projectId = op.projectId;
    projection.sessionId = op.sessionId;
    if (op.sessionRevision > projection.revision) projection.revision = op.sessionRevision;

    switch (op.type) {
      case "graph.initialized": {
        const graphId = typeof op.payload["graphId"] === "string" ? op.payload["graphId"] : undefined;
        const title = typeof op.payload["title"] === "string" ? op.payload["title"] : undefined;
        const status = asGraphStatus(op.payload["status"]);
        if (graphId) projection.graph.id = graphId;
        if (title) projection.graph.title = title;
        if (status) projection.graph.status = status;
        break;
      }
      case "session.status_set": {
        const status = asSessionStatus(op.payload["status"]);
        if (status) projection.sessionStatus = status;
        break;
      }
      case "node.status_set": {
        const nodeId = typeof op.payload["nodeId"] === "string" ? op.payload["nodeId"] : "";
        if (!nodeId) break;
        const node = ensureNode(projection, nodeId);
        const status = asNodeStatus(op.payload["status"]);
        if (status) node.status = status;

        const retryCount = op.payload["retryCount"];
        if (typeof retryCount === "number") node.retryCount = retryCount;
        const maxRetries = op.payload["maxRetries"];
        if (typeof maxRetries === "number") node.maxRetries = maxRetries;
        const error = op.payload["error"];
        if (typeof error === "string") node.error = error;
        break;
      }
      case "node.evidence_appended": {
        const nodeId = typeof op.payload["nodeId"] === "string" ? op.payload["nodeId"] : "";
        if (!nodeId) break;
        const node = ensureNode(projection, nodeId);
        const files = op.payload["filesWritten"];
        if (Array.isArray(files)) {
          node.filesWritten = files.filter((f): f is string => typeof f === "string" && !f.includes("node_modules/"));
        }
        break;
      }
      case "node.retry_scheduled": {
        const nodeId = typeof op.payload["nodeId"] === "string" ? op.payload["nodeId"] : "";
        if (!nodeId) break;
        const node = ensureNode(projection, nodeId);
        const retryCount = op.payload["retryCount"];
        if (typeof retryCount === "number") node.retryCount = retryCount;
        node.status = "ready";
        break;
      }
      case "checkpoint.paused": {
        projection.graph.status = "paused";
        projection.sessionStatus = "paused";
        break;
      }
      case "checkpoint.resumed": {
        projection.graph.status = "running";
        projection.sessionStatus = "running";
        break;
      }
      case "graph.completed": {
        projection.graph.status = "done";
        projection.sessionStatus = "done";
        break;
      }
      case "graph.failed": {
        projection.graph.status = "failed";
        projection.sessionStatus = "failed";
        break;
      }
      case "session.created": {
        break;
      }
      default:
        break;
    }
  }

  return projection;
}
