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

  // Monorepo 兼容：收集 repo 内多个 source root（root/src, apps/*/src, packages/*/src, 其它嵌套 src/）
  const sourceRoots = discoverSourceRoots(absPath);
  if (sourceRoots.length > 0 && filesRead < maxFiles) {
    const srcFiles = collectSourceFilesFromRoots(sourceRoots, absPath, maxFiles - filesRead);
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

function shouldIgnoreDir(name: string): boolean {
  if (IGNORE_DIRS.has(name)) return true;
  for (const pattern of IGNORE_DIRS) {
    if (pattern.endsWith("*") && name.startsWith(pattern.slice(0, -1))) return true;
  }
  return false;
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
    if (shouldIgnoreDir(entry.name)) continue;
    if (entry.name.startsWith(".") && entry.name !== ".env.example") continue;

    const indent = "  ".repeat(depth);

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

/**
 * 从 TypeScript 文件中提取 export 签名（函数、类、接口、类型、常量）。
 * 不依赖 tree-sitter，用正则匹配 export 语句，只返回签名行而非整个函数体。
 * 这让 LLM 能看到完整的 API 地图，而不是被字符限制截断的残缺代码。
 */
function extractExportSignatures(content: string): string {
  const lines = content.split("\n");
  const signatures: string[] = [];
  let i = 0;

  const declarationRe = /^\s*export\s+(default\s+)?(async\s+)?function|^\s*export\s+(abstract\s+)?class|^\s*export\s+interface|^\s*export\s+type\s+\w|^\s*export\s+enum|^\s*export\s+const\s+\w/;
  const blockLikeRe = /^\s*export\s+(default\s+)?(async\s+)?function|^\s*export\s+(abstract\s+)?class|^\s*export\s+interface|^\s*export\s+enum/;

  while (i < lines.length) {
    const line = lines[i];

    // 多行 export（export function / export class / export interface / export type / export const / export enum）
    if (declarationRe.test(line)) {
      let sig = line.trimEnd();

      // 如果是多行签名（参数跨行），最多追加 5 行
      if (!/{|=>|=/.test(sig) || sig.endsWith("(") || sig.endsWith(",")) {
        let j = i + 1;
        while (j < lines.length && j < i + 6) {
          sig += " " + lines[j].trim();
          if (/{|=>|=/.test(lines[j]) || lines[j].trim() === "") break;
          j++;
        }
      }

      if (blockLikeRe.test(line)) {
        const braceIndex = sig.indexOf("{");
        if (braceIndex > 0) sig = sig.slice(0, braceIndex).trimEnd() + " { … }";
      } else if (/=>/.test(sig)) {
        sig = sig.slice(0, sig.indexOf("=>")).trimEnd() + " => …";
      } else {
        const eqIndex = sig.indexOf("=");
        if (eqIndex > 0) sig = sig.slice(0, eqIndex).trimEnd() + " = …";
      }

      signatures.push(sig.trim());
    }

    // export { a, b, c } 重导出
    if (/^\s*export\s+\{/.test(line)) {
      signatures.push(line.trim());
    }

    // export * from 或 export { } from
    if (/^\s*export\s+(\*|\{).*from/.test(line)) {
      signatures.push(line.trim());
    }

    i++;
  }

  return signatures.length > 0 ? signatures.join("\n") : content.slice(0, 500);
}

function discoverSourceRoots(rootPath: string, maxDepth = 4): string[] {
  const discovered = new Set<string>();
  const ordered: string[] = [];

  const addIfSrcDir = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    const normalized = path.resolve(dir);
    if (discovered.has(normalized)) return;
    discovered.add(normalized);
    ordered.push(normalized);
  };

  // 优先常见 monorepo 目录，保证 apps/* 和 packages/* 都能进入摘要
  addIfSrcDir(path.join(rootPath, "src"));

  for (const group of ["apps", "packages"]) {
    const groupDir = path.join(rootPath, group);
    if (!fs.existsSync(groupDir)) continue;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(groupDir, { withFileTypes: true });
    } catch {
      continue;
    }

    entries
      .filter((entry) => entry.isDirectory() && !shouldIgnoreDir(entry.name) && !entry.name.startsWith("."))
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((entry) => addIfSrcDir(path.join(groupDir, entry.name, "src")));
  }

  // 再兜底扫描其余嵌套 src/ 目录（避免遗漏 services/*/src 等结构）
  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth) return;

    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (shouldIgnoreDir(entry.name) || entry.name.startsWith(".")) continue;

      const fullPath = path.join(dir, entry.name);
      if (entry.name === "src") {
        addIfSrcDir(fullPath);
        continue;
      }
      walk(fullPath, depth + 1);
    }
  };

  walk(rootPath, 0);
  return ordered;
}

function collectSourceFilesFromRoots(
  sourceRoots: string[],
  rootPath: string,
  limit: number
): Record<string, string> {
  const result: Record<string, string> = {};
  if (limit <= 0 || sourceRoots.length === 0) return result;

  const perRootBudget = Math.max(2, Math.ceil(limit / sourceRoots.length));

  for (const srcDir of sourceRoots) {
    if (Object.keys(result).length >= limit) break;

    const remaining = Math.min(perRootBudget, limit - Object.keys(result).length);
    const files = collectSourceFiles(srcDir, rootPath, remaining);
    for (const [rel, content] of Object.entries(files)) {
      if (Object.keys(result).length >= limit) break;
      if (!(rel in result)) result[rel] = content;
    }
  }

  return result;
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

    entries.sort((a, b) => {
      const aScore = filePriority(a.name, a.isDirectory());
      const bScore = filePriority(b.name, b.isDirectory());
      if (aScore !== bScore) return aScore - bScore;
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      if (count >= limit) break;
      if (shouldIgnoreDir(entry.name)) continue;

      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
        try {
          const content = fs.readFileSync(fullPath, "utf-8");
          const rel = path.relative(rootPath, fullPath).replace(/\\/g, "/");
          // 提取 export 签名而非字符截断，让 LLM 看到完整 API 地图
          result[rel] = extractExportSignatures(content);
          count++;
        } catch {}
      }
    }
  }

  walk(srcDir);
  return result;
}

function filePriority(name: string, isDirectory: boolean): number {
  if (isDirectory) return 2;
  if (/^(index|main|app)\.(ts|tsx)$/.test(name)) return 0;
  return 1;
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
    for (const [rel, content] of srcFiles.slice(0, 8)) {
      parts.push(`\n// ${rel}`);
      parts.push(content.slice(0, 800));
    }
  }

  parts.push("\n=== End Repository Context ===");

  return parts.join("\n");
}
