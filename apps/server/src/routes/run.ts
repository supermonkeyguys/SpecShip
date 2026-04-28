/**
 * routes/run.ts — POST /run
 *
 * ORCHESTRATOR_MODE=legacy  (default) — 直接调用 core run()
 * ORCHESTRATOR_MODE=temporal          — 启动 Temporal SpecRunWorkflow
 */

import { Router, Request, Response } from "express";
import * as path from "path";
import { run } from "../shipyard";
import { DEFAULT_CONFIG } from "../config";
import { sseManager } from "../sse";
import { watchSession, stopWatch } from "../sse-projection";
import { RunRequest, RunResponse, NodeStatus, GraphSummary } from "../types";
import { GraphNode } from "../graph";
import { getIsRunning, setIsRunning } from "./resume";
import {
  createProject, createSession, updateSession,
  getSessionOutputDir,
} from "../project";

const ORCHESTRATOR_MODE = process.env.ORCHESTRATOR_MODE ?? "legacy";

export const runRouter = Router();

// 记录当前活跃的 session/workflow，供 SSE / resume / files 使用
export let activeSession: { projectId: string; sessionId: string } | null = null;
export let activeWorkflowId: string | null = null;

export function setActiveRunContext(
  session: { projectId: string; sessionId: string } | null,
  workflowId: string | null
): void {
  activeSession = session;
  activeWorkflowId = workflowId;
}


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

  const proj = createProject(workDir, spec.slice(0, 40), repoPath);
  const sess = createSession(workDir, proj.id, spec);

  const outputDir = path.relative(workDir, getSessionOutputDir(workDir, proj.id, sess.id));

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

  if (ORCHESTRATOR_MODE === "temporal") {
    await runWithTemporal(spec, workDir, proj.id, sess.id, repoPath);
  } else {
    await runWithLegacy(spec, config, workDir, proj.id, sess.id);
  }
});

async function runWithLegacy(
  spec: string,
  config: ReturnType<typeof Object.assign>,
  workDir: string,
  projectId: string,
  sessionId: string
): Promise<void> {
  setIsRunning(true);
  activeWorkflowId = null;
  const startTime = Date.now();
  const prevNodeStatus = new Map<string, string>();

  try {
    const graph = await run(spec, config, undefined, (updatedGraph: import("../graph").ExecutionGraph) => {
      for (const node of updatedGraph.nodes.values()) {
        const prev = prevNodeStatus.get(node.id);
        if (prev !== node.status) {
          prevNodeStatus.set(node.id, node.status);
          sseManager.push({ type: "node_update", payload: toNodeStatus(node), projectId, sessionId });
        }
      }
    });

    updateSession(workDir, projectId, sessionId, {
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

    sseManager.push({
      type: graph.status === "done" ? "graph_done" : "graph_failed",
      payload: summary,
      projectId,
      sessionId,
    });
  } catch (e) {
    updateSession(workDir, projectId, sessionId, { status: "failed" });
    sseManager.push({ type: "log", payload: `Fatal error: ${(e as Error).message}`, projectId, sessionId });
  } finally {
    setIsRunning(false);
  }
}

async function runWithTemporal(
  spec: string,
  workDir: string,
  projectId: string,
  sessionId: string,
  repoPath?: string
): Promise<void> {
  setIsRunning(true);

  watchSession(workDir, projectId, sessionId);

  try {
    const { startSpecRunWorkflow, buildWorkflowId } = await import("@shipyard/orchestrator-temporal") as typeof import("@shipyard/orchestrator-temporal");

    const workflowId = buildWorkflowId(projectId, sessionId);
    activeWorkflowId = workflowId;

    const summary = await startSpecRunWorkflow({ spec, projectId, sessionId, workDir, repoPath });

    updateSession(workDir, projectId, sessionId, {
      status: summary.status === "done" ? "done" : "failed",
    });

    sseManager.push({
      type: summary.status === "done" ? "graph_done" : "graph_failed",
      projectId,
      sessionId,
      payload: {
        id: workflowId,
        title: spec.slice(0, 60),
        status: summary.status === "done" ? "done" : "failed",
        stats: {
          total: Object.keys(summary.nodeStatuses).length,
          done: Object.values(summary.nodeStatuses).filter((s) => s === "done").length,
          failed: Object.values(summary.nodeStatuses).filter((s) => s === "failed").length,
          filesGenerated: 0,
          verificationsPassed: 0,
          verificationsRun: 0,
        },
        durationMs: 0,
      } satisfies GraphSummary,
    });
  } catch (e) {
    updateSession(workDir, projectId, sessionId, { status: "failed" });
    sseManager.push({ type: "log", payload: `Temporal error: ${(e as Error).message}`, projectId, sessionId });
  } finally {
    stopWatch();
    setIsRunning(false);
  }
}

export function toNodeStatus(node: GraphNode): NodeStatus {
  return {
    id: node.id,
    title: node.title,
    status: node.status,
    specFragment: node.specFragment,
    dependsOn: node.dependsOn,
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
    retryCount: node.retryCount,
    error: node.error?.message,
    durationMs: node.evidence?.durationMs,
  };
}
