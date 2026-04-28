/**
 * repo.ts — 已有仓库上下文提取
 *
 * 读取仓库结构，生成精简摘要注入 Planner prompt。
 * 控制 context 大小：只提取关键信息，不塞整个仓库。
 */

import * as fs from "fs";
import * as path from "path";

// 忽略的目录/文件
const IGNORE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "coverage",
  ".shipyard*", "output", ".cache", "__pycache__", ".venv",
]);

const IGNORE_EXTS = new Set([
  ".lock", ".log", ".map", ".min.js", ".min.css", ".ico",
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".woff", ".woff2",
]);

// 值得读取内容的文件
const CONTENT_FILES = new Set([
  "package.json", "tsconfig.json", "README.md", "README.ts",
  ".env.example", "Makefile", "docker-compose.yml",
]);

export interface RepoContext {
  summary: string;       // 注入 Planner 的摘要文本
  rootPath: string;
  fileTree: string;      // 文件树（精简版）
  keyFiles: Record<string, string>;  // 关键文件内容
}

/**
 * 读取仓库，生成 Planner 可用的上下文摘要
 * @param repoPath 仓库根目录
 * @param maxFiles 最多读取的文件数（控制 context 大小）
 */
export function extractRepoContext(repoPath: string, maxFiles = 20): RepoContext {
  const absPath = path.resolve(repoPath);

  if (!fs.existsSync(absPath)) {
    throw new Error(`Repository path not found: ${absPath}`);
  }

  // 1. 构建文件树（最多 3 层深）
  const fileTree = buildFileTree(absPath, absPath, 0, 3);

  // 2. 读取关键文件内容
  const keyFiles: Record<string, string> = {};
  let filesRead = 0;

  // 优先读取根目录的关键文件
  for (const fname of CONTENT_FILES) {
    const fpath = path.join(absPath, fname);
    if (fs.existsSync(fpath) && filesRead < maxFiles) {
      try {
        const content = fs.readFileSync(fpath, "utf-8");
        keyFiles[fname] = content.slice(0, 2000); // 每个文件最多 2000 字符
        filesRead++;
      } catch {}
    }
  }

  // 读取 src/ 目录下的 TypeScript 入口文件
  const srcDir = path.join(absPath, "src");
  if (fs.existsSync(srcDir)) {
    const srcFiles = collectSourceFiles(srcDir, absPath, maxFiles - filesRead);
    for (const [rel, content] of Object.entries(srcFiles)) {
      keyFiles[rel] = content;
      filesRead++;
      if (filesRead >= maxFiles) break;
    }
  }

  // 3. 生成摘要
  const summary = buildSummary(absPath, fileTree, keyFiles);

  return { summary, rootPath: absPath, fileTree, keyFiles };
}

function buildFileTree(
  dirPath: string,
  rootPath: string,
  depth: number,
  maxDepth: number
): string {
  if (depth > maxDepth) return "";

  const lines: string[] = [];
  let entries: fs.Dirent[];

  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return "";
  }

  // 目录优先，然后文件
  entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    if (entry.name.startsWith(".") && entry.name !== ".env.example") continue;

    const indent = "  ".repeat(depth);
    const rel = path.relative(rootPath, path.join(dirPath, entry.name));

    if (entry.isDirectory()) {
      lines.push(`${indent}${entry.name}/`);
      const subTree = buildFileTree(
        path.join(dirPath, entry.name),
        rootPath,
        depth + 1,
        maxDepth
      );
      if (subTree) lines.push(subTree);
    } else {
      const ext = path.extname(entry.name);
      if (!IGNORE_EXTS.has(ext)) {
        lines.push(`${indent}${entry.name}`);
      }
    }
  }

  return lines.join("\n");
}

function collectSourceFiles(
  srcDir: string,
  rootPath: string,
  limit: number
): Record<string, string> {
  const result: Record<string, string> = {};
  let count = 0;

  function walk(dir: string) {
    if (count >= limit) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (count >= limit) break;
      if (IGNORE_DIRS.has(entry.name)) continue;

      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
        try {
          const content = fs.readFileSync(fullPath, "utf-8");
          const rel = path.relative(rootPath, fullPath);
          // 只取前 1500 字符，避免大文件撑爆 context
          result[rel] = content.slice(0, 1500);
          count++;
        } catch {}
      }
    }
  }

  walk(srcDir);
  return result;
}

function buildSummary(
  rootPath: string,
  fileTree: string,
  keyFiles: Record<string, string>
): string {
  const parts: string[] = [];

  parts.push(`=== Repository Context ===`);
  parts.push(`Root: ${rootPath}`);
  parts.push("");

  // package.json 摘要
  if (keyFiles["package.json"]) {
    try {
      const pkg = JSON.parse(keyFiles["package.json"]);
      parts.push(`Project: ${pkg.name ?? "unknown"} (${pkg.version ?? "?"})`)
      if (pkg.description) parts.push(`Description: ${pkg.description}`);
      const deps = Object.keys(pkg.dependencies ?? {}).slice(0, 10).join(", ");
      if (deps) parts.push(`Dependencies: ${deps}`);
      parts.push("");
    } catch {}
  }

  // 文件树
  parts.push("File structure:");
  parts.push(fileTree.split("\n").slice(0, 50).join("\n")); // 最多 50 行
  parts.push("");

  // 关键源文件
  const srcFiles = Object.entries(keyFiles).filter(([k]) => k !== "package.json" && k !== "tsconfig.json");
  if (srcFiles.length > 0) {
    parts.push("Key source files:");
    for (const [rel, content] of srcFiles.slice(0, 5)) {
      parts.push(`\n// ${rel}`);
      parts.push(content.slice(0, 800));
    }
  }

  parts.push("\n=== End Repository Context ===");

  return parts.join("\n");
}
