/**
 * routes/resume.ts
 *
 * GET  /api/status  — 查询当前是否有可恢复的任务
 * POST /api/resume  — 从断点恢复执行
 */

import { Router, Request, Response } from "express";
import { run } from "../../src/shipyard";
import { DEFAULT_CONFIG } from "../../src/config";
import { loadGraphCheckpoint, prepareGraphForResume, saveGraphCheckpoint } from "../../src/checkpoint";
import { sseManager } from "../sse";
import { GraphNode } from "../../src/graph";
import { NodeStatus, GraphSummary, StatusResponse, ResumeResponse } from "../types";

export const resumeRouter = Router();

// 共享 isRunning 状态（与 run.ts 解耦，通过导入共享）
let isRunning = false;

export function setIsRunning(v: boolean) { isRunning = v; }
export function getIsRunning() { return isRunning; }

// GET /api/status
resumeRouter.get("/status", (req: Request, res: Response) => {
  try {
    const config = { ...DEFAULT_CONFIG, workDir: process.cwd() };
    const graph = loadGraphCheckpoint(config.workDir);

    const doneCount = graph.stats.byStatus.done;
    const total = graph.stats.total;
    const hasUnfinished = graph.status !== "done" && graph.status !== "failed";

    res.json({
      isRunning,
      canResume: hasUnfinished && !isRunning,
      spec: graph.originalSpec,
      nodeCount: total,
      doneCount,
    } satisfies StatusResponse);
  } catch {
    res.json({
      isRunning,
      canResume: false,
    } satisfies StatusResponse);
  }
});

// POST /api/resume
resumeRouter.post("/resume", async (req: Request, res: Response) => {
  if (isRunning) {
    res.status(409).json({ ok: false, error: "A task is already running" } satisfies ResumeResponse);
    return;
  }

  const config = { ...DEFAULT_CONFIG, workDir: process.cwd() };

  let graph;
  try {
    const loaded = loadGraphCheckpoint(config.workDir);
    graph = prepareGraphForResume(loaded);
    saveGraphCheckpoint(config.workDir, graph);
  } catch (e) {
    res.status(400).json({ ok: false, error: `No checkpoint to resume: ${(e as Error).message}` } satisfies ResumeResponse);
    return;
  }

  const graphId = graph.id;
  sseManager.reset();
  res.json({ ok: true, graphId } satisfies ResumeResponse);

  isRunning = true;
  const startTime = Date.now();
  const prevNodeStatus = new Map<string, string>();

  try {
    const finalGraph = await run(graph.originalSpec, config, graph, (updatedGraph) => {
      for (const node of updatedGraph.nodes.values()) {
        const prev = prevNodeStatus.get(node.id);
        if (prev !== node.status) {
          prevNodeStatus.set(node.id, node.status);
          sseManager.push({ type: "node_update", payload: toNodeStatus(node) });
        }
      }
    });

    const summary: GraphSummary = {
      id: finalGraph.id,
      title: finalGraph.title,
      status: finalGraph.status === "done" ? "done" : "failed",
      stats: {
        total: finalGraph.stats.total,
        done: finalGraph.stats.byStatus.done,
        failed: finalGraph.stats.byStatus.failed,
        filesGenerated: finalGraph.stats.filesGenerated,
        verificationsPassed: finalGraph.stats.verificationsPassed,
        verificationsRun: finalGraph.stats.verificationsRun,
      },
      durationMs: Date.now() - startTime,
    };

    sseManager.push({ type: finalGraph.status === "done" ? "graph_done" : "graph_failed", payload: summary });
  } catch (e) {
    sseManager.push({ type: "log", payload: `Fatal error: ${(e as Error).message}` });
  } finally {
    isRunning = false;
  }
});

function toNodeStatus(node: GraphNode): NodeStatus {
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
