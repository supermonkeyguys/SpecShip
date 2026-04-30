/**
 * project.ts — Project/Session 管理
 *
 * 目录结构：
 *   .shipyard/
 *   └── projects/
 *       └── {projectId}/
 *           ├── project.json
 *           └── sessions/
 *               └── {sessionId}/
 *                   ├── graph.json
 *                   └── output/
 */

import * as fs from "fs";
import * as path from "path";
import type { SessionStatus } from "../graph/state";

const SHIPYARD_DIR = ".shipyard";
const PROJECTS_DIR = "projects";

export interface ProjectMeta {
  id: string;
  name: string;
  repoPath?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionMeta {
  id: string;
  projectId: string;
  spec: string;
  status: SessionStatus;
  starred?: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---- 路径工具 ----

export function getShipyardDir(workDir: string): string {
  return path.join(workDir, SHIPYARD_DIR);
}

export function getProjectDir(workDir: string, projectId: string): string {
  return path.join(workDir, SHIPYARD_DIR, PROJECTS_DIR, projectId);
}

export function getSessionDir(workDir: string, projectId: string, sessionId: string): string {
  return path.join(getProjectDir(workDir, projectId), "sessions", sessionId);
}

export function getSessionOutputDir(workDir: string, projectId: string, sessionId: string): string {
  return path.join(getSessionDir(workDir, projectId, sessionId), "output");
}

export function getSessionGraphPath(workDir: string, projectId: string, sessionId: string): string {
  return path.join(getSessionDir(workDir, projectId, sessionId), "graph.json");
}

// ---- Project CRUD ----

export function createProject(
  workDir: string,
  name: string,
  repoPath?: string
): ProjectMeta {
  const id = `proj-${Date.now()}`;
  const now = new Date().toISOString();
  const meta: ProjectMeta = { id, name, repoPath, createdAt: now, updatedAt: now };

  const dir = getProjectDir(workDir, id);
  fs.mkdirSync(path.join(dir, "sessions"), { recursive: true });
  fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify(meta, null, 2));

  return meta;
}

export function listProjects(workDir: string): ProjectMeta[] {
  const dir = path.join(workDir, SHIPYARD_DIR, PROJECTS_DIR);
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      try {
        return JSON.parse(
          fs.readFileSync(path.join(dir, e.name, "project.json"), "utf-8")
        ) as ProjectMeta;
      } catch {
        return null;
      }
    })
    .filter((p): p is ProjectMeta => p !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getProject(workDir: string, projectId: string): ProjectMeta | null {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(getProjectDir(workDir, projectId), "project.json"), "utf-8")
    ) as ProjectMeta;
  } catch {
    return null;
  }
}

export function updateProject(workDir: string, meta: ProjectMeta): void {
  meta.updatedAt = new Date().toISOString();
  fs.writeFileSync(
    path.join(getProjectDir(workDir, meta.id), "project.json"),
    JSON.stringify(meta, null, 2)
  );
}

// ---- Session CRUD ----

export function createSession(
  workDir: string,
  projectId: string,
  spec: string
): SessionMeta {
  const id = `sess-${Date.now()}`;
  const now = new Date().toISOString();
  const meta: SessionMeta = {
    id, projectId, spec,
    status: "running",
    createdAt: now, updatedAt: now,
  };

  const sessionDir = getSessionDir(workDir, projectId, id);
  fs.mkdirSync(path.join(sessionDir, "output"), { recursive: true });
  fs.writeFileSync(path.join(sessionDir, "session.json"), JSON.stringify(meta, null, 2));

  return meta;
}

export function listSessions(workDir: string, projectId: string): SessionMeta[] {
  const dir = path.join(getProjectDir(workDir, projectId), "sessions");
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      try {
        return JSON.parse(
          fs.readFileSync(path.join(dir, e.name, "session.json"), "utf-8")
        ) as SessionMeta;
      } catch {
        return null;
      }
    })
    .filter((s): s is SessionMeta => s !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function deleteSession(workDir: string, projectId: string, sessionId: string): void {
  const dir = getSessionDir(workDir, projectId, sessionId);
  fs.rmSync(dir, { recursive: true, force: true });
}

export function deleteProject(workDir: string, projectId: string): void {
  const dir = getProjectDir(workDir, projectId);
  fs.rmSync(dir, { recursive: true, force: true });
}

export function updateSession(
  workDir: string,
  projectId: string,
  sessionId: string,
  update: Partial<Pick<SessionMeta, "status" | "starred">>
): void {
  const sessionPath = path.join(getSessionDir(workDir, projectId, sessionId), "session.json");
  try {
    const meta = JSON.parse(fs.readFileSync(sessionPath, "utf-8")) as SessionMeta;
    Object.assign(meta, update, { updatedAt: new Date().toISOString() });
    fs.writeFileSync(sessionPath, JSON.stringify(meta, null, 2));
  } catch {}
}

// ---- 兼容旧 checkpoint（迁移用）----

/** 把旧的 .shipyard-graph.json 迁移到新结构 */
export function migrateOldCheckpoint(workDir: string): { projectId: string; sessionId: string } | null {
  const oldPath = path.join(workDir, ".shipyard-graph.json");
  if (!fs.existsSync(oldPath)) return null;

  try {
    const raw = JSON.parse(fs.readFileSync(oldPath, "utf-8"));
    const spec = raw.originalSpec ?? "Migrated task";
    const proj = createProject(workDir, spec.slice(0, 40));
    const sess = createSession(workDir, proj.id, spec);

    // 把旧 graph.json 复制过去
    fs.copyFileSync(oldPath, getSessionGraphPath(workDir, proj.id, sess.id));

    // 把旧 output/ 复制过去
    const oldOutput = path.join(workDir, "output");
    const newOutput = getSessionOutputDir(workDir, proj.id, sess.id);
    if (fs.existsSync(oldOutput)) {
      copyDir(oldOutput, newOutput);
    }

    return { projectId: proj.id, sessionId: sess.id };
  } catch {
    return null;
  }
}

function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}
