/**
 * routes/preview.ts — session preview discovery + static serving
 */

import { Router, Request, Response } from "express";
import * as fs from "fs";
import * as path from "path";
import type { PreviewKind, PreviewStatusResponse } from "../types";
import { getSessionOutputDir } from "../project";
import {
  getLivePreviewCapability,
  getLivePreviewState,
  startLivePreview,
  stopLivePreview,
} from "../preview-manager";

export const previewRouter = Router();

const DEBUG_PREFIX = "[shipyard:server:preview]";
const CANDIDATE_ENTRIES = [
  "index.html",
  "dist/index.html",
  "public/index.html",
  "build/index.html",
];

function resolvePreviewEntry(outputDir: string): { entryPath: string; fullPath: string } | null {
  for (const entryPath of CANDIDATE_ENTRIES) {
    const fullPath = path.join(outputDir, entryPath);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      return { entryPath, fullPath };
    }
  }
  return null;
}

function buildStaticUrl(pid: string, sid: string, entryPath: string): string {
  return `/api/projects/${pid}/sessions/${sid}/preview/content/${entryPath}`;
}

function buildPreviewStatus(pid: string, sid: string, outputDir: string): PreviewStatusResponse {
  const staticEntry = resolvePreviewEntry(outputDir);
  const liveCapability = getLivePreviewCapability(outputDir);
  const liveState = getLivePreviewState(pid, sid);

  const staticUrl = staticEntry ? buildStaticUrl(pid, sid, staticEntry.entryPath) : undefined;
  const liveUrl = liveState?.url;

  let kind: PreviewKind = "none";
  let url: string | undefined;
  let reason: string | undefined;

  if (liveState && (liveState.status === "starting" || liveState.status === "running") && liveUrl) {
    kind = "live";
    url = liveUrl;
  } else if (staticUrl) {
    kind = "static";
    url = staticUrl;
  } else if (liveCapability.supported) {
    kind = "live";
    reason = liveState?.error ?? "Live preview is available. Start it to open the generated app.";
  } else {
    reason = "No static preview entry found, and live preview is not supported for this output.";
  }

  return {
    ok: true,
    supported: Boolean(staticUrl || liveCapability.supported || liveState),
    kind,
    url,
    entryPath: staticEntry?.entryPath,
    reason,
    staticSupported: Boolean(staticUrl),
    staticUrl,
    liveSupported: liveCapability.supported,
    liveStatus: liveState?.status ?? "idle",
    liveUrl,
    livePort: liveState?.port,
    liveCommand: liveState?.command ?? liveCapability.command,
    liveError: liveState?.error,
  };
}

function rewriteHtmlForPreview(html: string, pid: string, sid: string, filePath: string): string {
  const dir = path.posix.dirname(filePath);
  const basePrefix = `/api/projects/${pid}/sessions/${sid}/preview/content/${dir === "." ? "" : `${dir}/`}`;

  let next = html;
  if (!/<base\s/i.test(next)) {
    next = next.replace(/<head([^>]*)>/i, `<head$1><base href="${basePrefix}">`);
  }

  next = next.replace(/(href|src|action|poster)=(["'])\/(?!\/)([^"']+)/g, (_match, attr, quote, assetPath) => {
    return `${attr}=${quote}${basePrefix}${assetPath}`;
  });

  next = next.replace(/url\((["']?)\/(?!\/)([^)"']+)\)/g, (_match, quote, assetPath) => {
    return `url(${quote}${basePrefix}${assetPath}${quote})`;
  });

  return next;
}

previewRouter.get("/projects/:pid/sessions/:sid/preview", (req: Request, res: Response) => {
  const { pid, sid } = req.params as { pid: string; sid: string };
  const workDir = process.env.WORK_DIR ?? process.cwd();
  const outputDir = getSessionOutputDir(workDir, pid, sid);

  if (!fs.existsSync(outputDir)) {
    const payload: PreviewStatusResponse = {
      ok: true,
      supported: false,
      kind: "none",
      reason: "No output directory found for this session.",
      staticSupported: false,
      liveSupported: false,
      liveStatus: "idle",
    };
    console.log(DEBUG_PREFIX, "status", { pid, sid, ...payload });
    res.json(payload);
    return;
  }

  const payload = buildPreviewStatus(pid, sid, outputDir);
  console.log(DEBUG_PREFIX, "status", { pid, sid, ...payload });
  res.json(payload);
});

previewRouter.post("/projects/:pid/sessions/:sid/preview/live/start", async (req: Request, res: Response) => {
  const { pid, sid } = req.params as { pid: string; sid: string };
  const workDir = process.env.WORK_DIR ?? process.cwd();
  const outputDir = getSessionOutputDir(workDir, pid, sid);

  if (!fs.existsSync(outputDir)) {
    res.status(404).json({ ok: false, supported: false, kind: "none", reason: "Session output directory not found." } satisfies PreviewStatusResponse);
    return;
  }

  await startLivePreview(pid, sid, outputDir);
  const payload = buildPreviewStatus(pid, sid, outputDir);
  console.log(DEBUG_PREFIX, "live:start", { pid, sid, ...payload });
  res.json(payload);
});

previewRouter.post("/projects/:pid/sessions/:sid/preview/live/stop", (req: Request, res: Response) => {
  const { pid, sid } = req.params as { pid: string; sid: string };
  const workDir = process.env.WORK_DIR ?? process.cwd();
  const outputDir = getSessionOutputDir(workDir, pid, sid);

  stopLivePreview(pid, sid);
  const payload = buildPreviewStatus(pid, sid, outputDir);
  console.log(DEBUG_PREFIX, "live:stop", { pid, sid, ...payload });
  res.json(payload);
});

previewRouter.get("/projects/:pid/sessions/:sid/preview/content/*path", (req: Request, res: Response) => {
  const { pid, sid } = req.params as { pid: string; sid: string };
  const rawPath = String(req.params.path ?? "").replace(/^\/+/, "");
  const workDir = process.env.WORK_DIR ?? process.cwd();
  const outputDir = getSessionOutputDir(workDir, pid, sid);

  if (!rawPath) {
    res.status(400).send("preview path required");
    return;
  }

  const fullPath = path.join(outputDir, rawPath);
  if (!fullPath.startsWith(outputDir)) {
    res.status(403).send("Forbidden");
    return;
  }

  if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
    res.status(404).send("Not found");
    return;
  }

  if (fullPath.endsWith(".html")) {
    const html = fs.readFileSync(fullPath, "utf-8");
    res.type("html").send(rewriteHtmlForPreview(html, pid, sid, rawPath));
    return;
  }

  res.sendFile(fullPath);
});
