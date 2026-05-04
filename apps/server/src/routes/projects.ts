/**
 * routes/projects.ts
 *
 * GET /api/projects          — 列出所有 project + sessions
 * GET /api/projects/:pid/sessions/:sid/files — 列出 session 的文件
 */

import { Router, Request, Response } from "express";
import * as fs from "fs";
import * as path from "path";
import {
  listProjects,
  listSessions,
  getSessionOutputDir,
  getSessionGraphPath,
  deleteSession,
  deleteProject,
  updateSession,
} from "../project";
import { loadGraphCheckpoint } from "../checkpoint";
import { mapGraphStatusToSessionStatus } from "../state";
import { appendSessionOperation, getSessionRevision, readSessionOperations } from "../op-log";
import { replaySessionOperations } from "../op-replay";
import { ProjectsResponse, FilesResponse, FileEntry } from "../types";

export const projectsRouter = Router();

function serializeSnapshotGraph(graph: ReturnType<typeof loadGraphCheckpoint>) {
  return {
    title: graph.title,
    status: graph.status,
    nodes: Array.from(graph.nodes.entries()).map(([id, node]) => ({
      id,
      title: node.title,
      status: node.status,
      nodeType: node.type,
      specFragment: node.specFragment,
      dependsOn: node.dependsOn,
      retryCount: node.retryCount,
      maxRetries: node.maxRetries,
      error: node.error?.message,
      errorCategory: node.error?.category,
      errorRecoverable: node.error?.recoverable,
      durationMs: node.evidence?.durationMs,
      filesWritten: node.evidence?.filesWritten.map((f) => f.path) ?? [],
      toolCalls: node.evidence?.toolCalls.map((t) => ({
        tool: t.tool,
        input: t.input,
        output: t.output,
        success: t.success,
        timestamp: t.timestamp,
      })) ?? [],
      verifications: node.evidence?.verifications.map((v) => ({
        type: v.type,
        passed: v.passed,
        summary: v.output.slice(0, 100),
      })) ?? [],
    })),
  };
}

function appendBackfillOp(
  workDir: string,
  projectId: string,
  sessionId: string,
  type: "session.created" | "session.status_set" | "graph.initialized" | "node.status_set" | "node.evidence_appended" | "node.retry_scheduled" | "checkpoint.paused" | "checkpoint.resumed" | "graph.completed" | "graph.failed",
  payload: Record<string, unknown>
): void {
  const revision = getSessionRevision(workDir, projectId, sessionId);
  appendSessionOperation(
    workDir,
    {
      v: 1,
      projectId,
      sessionId,
      actor: "system",
      source: "scheduler",
      type,
      payload,
    },
    revision
  );
}

function ensureBackfilledOperations(
  workDir: string,
  projectId: string,
  sessionId: string,
  snapshotGraphPath: string
): void {
  const existing = readSessionOperations(workDir, projectId, sessionId);
  if (existing.length > 0) return;

  const graph = loadGraphCheckpoint(workDir, snapshotGraphPath);

  appendBackfillOp(workDir, projectId, sessionId, "session.created", {
    backfilled: true,
    graphId: graph.id,
  });
  appendBackfillOp(workDir, projectId, sessionId, "graph.initialized", {
    graphId: graph.id,
    title: graph.title,
    status: graph.status,
    backfilled: true,
  });

  for (const node of graph.nodes.values()) {
    appendBackfillOp(workDir, projectId, sessionId, "node.status_set", {
      nodeId: node.id,
      title: node.title,
      nodeType: node.type,
      specFragment: node.specFragment,
      dependsOn: node.dependsOn,
      status: node.status,
      retryCount: node.retryCount,
      maxRetries: node.maxRetries,
      error: node.error?.message,
      errorCategory: node.error?.category,
      errorRecoverable: node.error?.recoverable,
      durationMs: node.evidence?.durationMs,
      backfilled: true,
    });

    const filesWritten = node.evidence?.filesWritten.map((f) => f.path) ?? [];
    if (filesWritten.length > 0 || (node.evidence?.toolCalls.length ?? 0) > 0 || (node.evidence?.verifications.length ?? 0) > 0) {
      appendBackfillOp(workDir, projectId, sessionId, "node.evidence_appended", {
        nodeId: node.id,
        filesWritten,
        toolCalls: node.evidence?.toolCalls ?? [],
        verifications: node.evidence?.verifications ?? [],
        backfilled: true,
      });
    }

    if (node.status === "ready" && node.retryCount > 0) {
      appendBackfillOp(workDir, projectId, sessionId, "node.retry_scheduled", {
        nodeId: node.id,
        retryCount: node.retryCount,
        maxRetries: node.maxRetries,
        backfilled: true,
      });
    }
  }

  if (graph.status === "done") {
    appendBackfillOp(workDir, projectId, sessionId, "graph.completed", {
      graphId: graph.id,
      title: graph.title,
      status: graph.status,
      backfilled: true,
    });
  }
  if (graph.status === "failed") {
    appendBackfillOp(workDir, projectId, sessionId, "graph.failed", {
      graphId: graph.id,
      title: graph.title,
      status: graph.status,
      backfilled: true,
    });
  }

  appendBackfillOp(workDir, projectId, sessionId, "session.status_set", {
    status: mapGraphStatusToSessionStatus(graph.status),
    backfilled: true,
  });
}

function summarizeNodeStatuses(nodes: Array<{ status: string }>): Record<string, number> {
  return nodes.reduce<Record<string, number>>((acc, node) => {
    acc[node.status] = (acc[node.status] ?? 0) + 1;
    return acc;
  }, {});
}

function buildParityReport(
  projectionNodes: Record<string, { status: string }>,
  snapshotSerialized: ReturnType<typeof serializeSnapshotGraph> | null,
  projectionGraphStatus: string | undefined
): {
  nodeCount: { snapshot: number; replay: number; match: boolean };
  statusDistribution: { snapshot: Record<string, number>; replay: Record<string, number>; match: boolean };
  terminalStatus: { snapshot: string | undefined; replay: string | undefined; match: boolean };
  mismatchedNodeStatuses: string[];
} | null {
  if (!snapshotSerialized) return null;

  const projectionById = projectionNodes;

  const mismatchedNodeStatuses: string[] = [];
  for (const node of snapshotSerialized.nodes) {
    const projected = projectionById[node.id];
    if (projected && projected.status !== node.status) {
      mismatchedNodeStatuses.push(node.id);
    }
  }

  const snapshotStatusDistribution = summarizeNodeStatuses(snapshotSerialized.nodes);
  const replayNodes = Object.values(projectionById).map((node) => ({ status: node.status }));
  const replayStatusDistribution = summarizeNodeStatuses(replayNodes);

  const snapshotStatus = snapshotSerialized.status;
  const replayStatus = projectionGraphStatus;

  return {
    nodeCount: {
      snapshot: snapshotSerialized.nodes.length,
      replay: Object.keys(projectionById).length,
      match: snapshotSerialized.nodes.length === Object.keys(projectionById).length,
    },
    statusDistribution: {
      snapshot: snapshotStatusDistribution,
      replay: replayStatusDistribution,
      match: JSON.stringify(snapshotStatusDistribution) === JSON.stringify(replayStatusDistribution),
    },
    terminalStatus: {
      snapshot: snapshotStatus,
      replay: replayStatus,
      match: snapshotStatus === replayStatus,
    },
    mismatchedNodeStatuses,
  };
}

function buildEventGraphResponse(
  workDir: string,
  projectId: string,
  sessionId: string,
  snapshotGraphPath: string
) {
  ensureBackfilledOperations(workDir, projectId, sessionId, snapshotGraphPath);

  const ops = readSessionOperations(workDir, projectId, sessionId);
  const projection = replaySessionOperations(ops);

  let snapshotSerialized: ReturnType<typeof serializeSnapshotGraph> | null = null;
  try {
    snapshotSerialized = serializeSnapshotGraph(loadGraphCheckpoint(workDir, snapshotGraphPath));
  } catch {
    snapshotSerialized = null;
  }

  const projectionNodes = projection.nodes;

  const nodes = snapshotSerialized
    ? snapshotSerialized.nodes.map((node) => {
        const projected = projectionNodes[node.id];
        if (!projected) return node;
        return {
          ...node,
          status: projected.status,
          retryCount: projected.retryCount,
          maxRetries: projected.maxRetries,
          error: projected.error,
          filesWritten: projected.filesWritten,
        };
      })
    : Object.values(projectionNodes).map((node) => ({
        id: node.id,
        title: node.id,
        status: node.status,
        nodeType: "implement" as const,
        specFragment: "",
        dependsOn: [],
        retryCount: node.retryCount,
        maxRetries: node.maxRetries,
        error: node.error,
        errorCategory: undefined,
        errorRecoverable: undefined,
        durationMs: undefined,
        filesWritten: node.filesWritten,
        toolCalls: [],
        verifications: [],
      }));

  const parity = buildParityReport(projectionNodes, snapshotSerialized, projection.graph.status);

  if (parity && (!parity.nodeCount.match || !parity.statusDistribution.match || !parity.terminalStatus.match || parity.mismatchedNodeStatuses.length > 0)) {
    console.warn("[shipyard:server:projects] replay parity mismatch", {
      projectId,
      sessionId,
      parity,
    });
  }

  return {
    ok: true,
    nodes,
    title: projection.graph.title ?? snapshotSerialized?.title ?? "",
    status: projection.graph.status ?? snapshotSerialized?.status ?? "unknown",
    revision: projection.revision,
    source: "events",
    parity,
  };
}

projectsRouter.get("/projects", (req: Request, res: Response) => {
  const workDir = process.env.WORK_DIR ?? process.cwd();
  const projects = listProjects(workDir);

  const result = projects.map((p) => ({
    ...p,
    sessions: listSessions(workDir, p.id).map((s) => ({
      id: s.id,
      spec: s.spec,
      status: s.status,
      starred: s.starred ?? false,
      createdAt: s.createdAt,
    })),
  }));

  res.json({ projects: result } satisfies ProjectsResponse);
});

projectsRouter.get("/projects/:pid/sessions/:sid/files", (req: Request, res: Response) => {
  const { pid, sid } = req.params as { pid: string; sid: string };
  const workDir = process.env.WORK_DIR ?? process.cwd();
  const outputDir = getSessionOutputDir(workDir, pid, sid);

  if (!fs.existsSync(outputDir)) {
    res.json({ files: [] } satisfies FilesResponse);
    return;
  }

  const files = walkDir(outputDir).map((filePath): FileEntry => {
    const stat = fs.statSync(filePath);
    return {
      path: path.relative(outputDir, filePath),
      sizeBytes: stat.size,
      updatedAt: stat.mtime.toISOString(),
    };
  });

  res.json({ files } satisfies FilesResponse);
});

projectsRouter.get("/projects/:pid/sessions/:sid/file", (req: Request, res: Response) => {
  const { pid, sid } = req.params as { pid: string; sid: string };
  const filePath = String(req.query["path"] ?? "");
  if (!filePath) {
    res.status(400).json({ error: "path required" });
    return;
  }

  const workDir = process.env.WORK_DIR ?? process.cwd();
  const outputDir = getSessionOutputDir(workDir, pid, sid);
  const fullPath = path.join(outputDir, filePath);

  if (!fullPath.startsWith(outputDir)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  if (!fs.existsSync(fullPath)) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  res.json({ content: fs.readFileSync(fullPath, "utf-8") });
});

projectsRouter.get("/projects/:pid/sessions/:sid/graph", (req: Request, res: Response) => {
  const { pid, sid } = req.params as { pid: string; sid: string };
  const requestedSource = String(req.query["source"] ?? "events");
  const source = requestedSource === "snapshot" ? "snapshot" : "events";
  const workDir = process.env.WORK_DIR ?? process.cwd();
  const graphPath = getSessionGraphPath(workDir, pid, sid);

  if (source === "snapshot") {
    try {
      const graph = loadGraphCheckpoint(workDir, graphPath);
      const serialized = serializeSnapshotGraph(graph);
      res.json({ ok: true, nodes: serialized.nodes, title: serialized.title, status: serialized.status, source: "snapshot" });
    } catch {
      res.json({ ok: false, nodes: [], title: "", status: "unknown", source: "snapshot" });
    }
    return;
  }

  try {
    const eventResponse = buildEventGraphResponse(workDir, pid, sid, graphPath);
    res.json(eventResponse);
  } catch (eventError) {
    console.warn("[shipyard:server:projects] events graph read failed, fallback snapshot", {
      projectId: pid,
      sessionId: sid,
      error: (eventError as Error).message,
    });

    try {
      const graph = loadGraphCheckpoint(workDir, graphPath);
      const serialized = serializeSnapshotGraph(graph);
      res.json({
        ok: true,
        nodes: serialized.nodes,
        title: serialized.title,
        status: serialized.status,
        source: "snapshot_fallback",
      });
    } catch {
      res.json({ ok: false, nodes: [], title: "", status: "unknown", source: "events" });
    }
  }
});

projectsRouter.delete("/projects/:pid/sessions/:sid", (req: Request, res: Response) => {
  const { pid, sid } = req.params as { pid: string; sid: string };
  const workDir = process.env.WORK_DIR ?? process.cwd();
  try {
    deleteSession(workDir, pid, sid);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

projectsRouter.delete("/projects/:pid", (req: Request, res: Response) => {
  const { pid } = req.params as { pid: string };
  const workDir = process.env.WORK_DIR ?? process.cwd();
  try {
    deleteProject(workDir, pid);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

projectsRouter.patch("/projects/:pid/sessions/:sid", (req: Request, res: Response) => {
  const { pid, sid } = req.params as { pid: string; sid: string };
  const { starred } = req.body as { starred?: boolean };
  const workDir = process.env.WORK_DIR ?? process.cwd();
  try {
    if (typeof starred === "boolean") {
      updateSession(workDir, pid, sid, { starred });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

function walkDir(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walkDir(fullPath));
    else results.push(fullPath);
  }
  return results;
}
