/**
 * routes/projects.ts
 *
 * GET /api/projects          — 列出所有 project + sessions
 * GET /api/projects/:pid/sessions/:sid/files — 列出 session 的文件
 */

import { Router, Request, Response } from "express";
import * as fs from "fs";
import * as path from "path";
import { listProjects, listSessions, getSessionOutputDir, getSessionGraphPath } from "../project";
import { loadGraphCheckpoint } from "../checkpoint";
import { ProjectsResponse, FilesResponse, FileEntry } from "../types";

export const projectsRouter = Router();

// GET /projects
projectsRouter.get("/projects", (req: Request, res: Response) => {
  const workDir = process.cwd();
  const projects = listProjects(workDir);

  const result = projects.map((p) => ({
    ...p,
    sessions: listSessions(workDir, p.id),
  }));

  res.json({ projects: result } satisfies ProjectsResponse);
});

// GET /projects/:pid/sessions/:sid/files
projectsRouter.get("/projects/:pid/sessions/:sid/files", (req: Request, res: Response) => {
  const { pid, sid } = req.params as { pid: string; sid: string };
  const workDir = process.cwd();
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

// GET /projects/:pid/sessions/:sid/file?path=xxx
projectsRouter.get("/projects/:pid/sessions/:sid/file", (req: Request, res: Response) => {
  const { pid, sid } = req.params as { pid: string; sid: string };
  const filePath = String(req.query["path"] ?? "");
  if (!filePath) {
    res.status(400).json({ error: "path required" });
    return;
  }

  const workDir = process.cwd();
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

// GET /projects/:pid/sessions/:sid/graph — 返回 session 的图状态（节点历史）
projectsRouter.get("/projects/:pid/sessions/:sid/graph", (req: Request, res: Response) => {
  const { pid, sid } = req.params as { pid: string; sid: string };
  const workDir = process.cwd();
  const graphPath = getSessionGraphPath(workDir, pid, sid);

  try {
    const graph = loadGraphCheckpoint(workDir, graphPath);
    // 序列化 Map → Array 供前端使用
    const nodes = Array.from(graph.nodes.entries()).map(([id, node]) => ({
      id,
      title: node.title,
      status: node.status,
      specFragment: node.specFragment,
      dependsOn: node.dependsOn,
      retryCount: node.retryCount,
      error: node.error?.message,
      durationMs: node.evidence?.durationMs,
      filesWritten: node.evidence?.filesWritten.map((f) => f.path) ?? [],
      verifications: node.evidence?.verifications.map((v) => ({
        type: v.type,
        passed: v.passed,
        summary: v.output.slice(0, 100),
      })) ?? [],
    }));
    res.json({ ok: true, nodes, title: graph.title, status: graph.status });
  } catch {
    res.json({ ok: false, nodes: [], title: "", status: "unknown" });
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
