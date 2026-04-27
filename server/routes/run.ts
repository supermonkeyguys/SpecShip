/**
 * routes/run.ts — POST /run
 */

import { Router, Request, Response } from "express";
import * as path from "path";
import { run } from "../../src/shipyard";
import { DEFAULT_CONFIG } from "../../src/config";
import { sseManager } from "../sse";
import { RunRequest, RunResponse, NodeStatus, GraphSummary } from "../types";
import { GraphNode } from "../../src/graph";
import { getIsRunning, setIsRunning } from "./resume";
import {
  createProject, createSession, updateSession,
  getSessionOutputDir, getSessionGraphPath,
} from "../../src/project";

export const runRouter = Router();

// 记录当前活跃的 session，供 SSE/files 使用
export let activeSession: { projectId: string; sessionId: string } | null = null;

runRouter.post("/run", async (req: Request, res: Response) => {
  const { spec, repoPath } = req.body as RunRequest;

  if (!spec?.trim()) {
    res.status(400).json({ ok: false, error: "spec is required" } satisfies RunResponse);
    return;
  }

  if (getIsRunning()) {
    res.status(409).json({ ok: false, error: "A task is already running" } satisfies RunResponse);
    return;
  }

  const workDir = process.cwd();

  // 创建 project + session
  const proj = createProject(workDir, spec.slice(0, 40), repoPath);
  const sess = createSession(workDir, proj.id, spec);

  const outputDir = path.relative(workDir, getSessionOutputDir(workDir, proj.id, sess.id));
  const sessionGraphPath = getSessionGraphPath(workDir, proj.id, sess.id);

  const config = {
    ...DEFAULT_CONFIG,
    workDir,
    repoPath: repoPath ?? undefined,
    projectId: proj.id,
    sessionId: sess.id,
    outputDir,
  };

  activeSession = { projectId: proj.id, sessionId: sess.id };
  sseManager.reset();

  res.json({ ok: true, graphId: sess.id, projectId: proj.id, sessionId: sess.id } satisfies RunResponse);

  setIsRunning(true);
  const startTime = Date.now();
  const prevNodeStatus = new Map<string, string>();

  try {
    const graph = await run(spec, config, undefined, (updatedGraph) => {
      for (const node of updatedGraph.nodes.values()) {
        const prev = prevNodeStatus.get(node.id);
        if (prev !== node.status) {
          prevNodeStatus.set(node.id, node.status);
          sseManager.push({ type: "node_update", payload: toNodeStatus(node) });
        }
      }
    });

    updateSession(workDir, proj.id, sess.id, {
      status: graph.status === "done" ? "done" : "failed",
    });

    const summary: GraphSummary = {
      id: graph.id,
      title: graph.title,
      status: graph.status === "done" ? "done" : "failed",
      stats: {
        total: graph.stats.total,
        done: graph.stats.byStatus.done,
        failed: graph.stats.byStatus.failed,
        filesGenerated: graph.stats.filesGenerated,
        verificationsPassed: graph.stats.verificationsPassed,
        verificationsRun: graph.stats.verificationsRun,
      },
      durationMs: Date.now() - startTime,
    };

    sseManager.push({ type: graph.status === "done" ? "graph_done" : "graph_failed", payload: summary });
  } catch (e) {
    updateSession(workDir, proj.id, sess.id, { status: "failed" });
    sseManager.push({ type: "log", payload: `Fatal error: ${(e as Error).message}` });
  } finally {
    setIsRunning(false);
  }
});

export function toNodeStatus(node: GraphNode): NodeStatus {
  return {
    id: node.id,
    title: node.title,
    status: node.status,
    specFragment: node.specFragment,
    dependsOn: node.dependsOn,
    filesWritten: node.evidence?.filesWritten.map((f) => f.path) ?? [],
    verifications: node.evidence?.verifications.map((v) => ({
      type: v.type,
      passed: v.passed,
      summary: v.output.slice(0, 100),
    })) ?? [],
    retryCount: node.retryCount,
    error: node.error?.message,
    durationMs: node.evidence?.durationMs,
  };
}
