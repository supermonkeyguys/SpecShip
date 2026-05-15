/**
 * routes/files.ts — GET /files
 *
 * 返回 output/ 目录下所有生成的文件列表。
 */

import { Router, Request, Response } from "express";
import * as fs from "fs";
import * as path from "path";
import { FilesResponse, FileEntry } from "../types";

export const filesRouter = Router();

// GET /file?path=xxx — 读取单个文件内容（用 query string 避免路由语法问题）
filesRouter.get("/file", (req: Request, res: Response) => {
  const filePath = String(req.query["path"] ?? "");
  if (!filePath) {
    res.status(400).json({ error: "path query param required" });
    return;
  }

  const outputDir = path.join(process.env.WORK_DIR ?? process.cwd(), "output");
  const fullPath = path.join(outputDir, filePath);

  // 安全检查：不允许路径穿越
  if (!fullPath.startsWith(outputDir)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  try {
    const content = fs.readFileSync(fullPath, "utf-8");
    res.json({ content });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

filesRouter.get("/files", (req: Request, res: Response) => {
  const outputDir = path.join(process.env.WORK_DIR ?? process.cwd(), "output");

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

const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", "build", ".cache", ".next", ".turbo"]);
const IGNORED_FILES = new Set([".DS_Store", "package-lock.json", "yarn.lock", "pnpm-lock.yaml"]);

function walkDir(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      results.push(...walkDir(path.join(dir, entry.name)));
    } else {
      if (IGNORED_FILES.has(entry.name)) continue;
      results.push(path.join(dir, entry.name));
    }
  }
  return results;
}
