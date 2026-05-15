/**
 * routes/preview.ts — session preview discovery + static serving
 */

import { Router, Request, Response } from "express";
import * as http from "http";
import * as net from "net";
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
const PREVIEW_DEBUG = process.env.PREVIEW_DEBUG === "1";

function debugLog(event: string, payload: unknown): void {
  if (!PREVIEW_DEBUG) return;
  console.log(DEBUG_PREFIX, event, payload);
}
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
  // Use server-side proxy URL for iframe to avoid cross-origin restrictions
  const liveProxyUrl = liveState?.port ? `/api/projects/${pid}/sessions/${sid}/preview/live/proxy/` : undefined;

  let kind: PreviewKind = "none";
  let url: string | undefined;
  let reason: string | undefined;

  if (liveState && (liveState.status === "starting" || liveState.status === "running") && liveProxyUrl) {
    kind = "live";
    url = liveProxyUrl;
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
    debugLog("status", { pid, sid, ...payload });
    res.json(payload);
    return;
  }

  const payload = buildPreviewStatus(pid, sid, outputDir);
  debugLog("status", { pid, sid, ...payload });
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
  debugLog("live:start", { pid, sid, ...payload });
  res.json(payload);
});

previewRouter.post("/projects/:pid/sessions/:sid/preview/live/stop", (req: Request, res: Response) => {
  const { pid, sid } = req.params as { pid: string; sid: string };
  const workDir = process.env.WORK_DIR ?? process.cwd();
  const outputDir = getSessionOutputDir(workDir, pid, sid);

  stopLivePreview(pid, sid);
  const payload = buildPreviewStatus(pid, sid, outputDir);
  debugLog("live:stop", { pid, sid, ...payload });
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

// Reverse-proxy live preview traffic through the server to avoid cross-origin iframe issues
previewRouter.all("/projects/:pid/sessions/:sid/preview/live/proxy/{*path}", (req: Request, res: Response) => {
  const { pid, sid } = req.params as { pid: string; sid: string };
  const paramPath = (req.params as Record<string, string | string[]>).path ?? "";
  const rawPath = (Array.isArray(paramPath) ? paramPath.join("/") : String(paramPath)).replace(/^\/+/, "");
  const liveState = getLivePreviewState(pid, sid);

  if (!liveState || !liveState.port || (liveState.status !== "running" && liveState.status !== "starting")) {
    res.status(503).send("Live preview not running");
    return;
  }

  const targetPath = `/${rawPath}${req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""}`;
  const options: http.RequestOptions = {
    hostname: "127.0.0.1",
    port: liveState.port,
    path: targetPath || "/",
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${liveState.port}` },
  };

  const proxyBase = `/api/projects/${pid}/sessions/${sid}/preview/live/proxy`;
  const isHtml = req.path.endsWith(".html") || req.path.endsWith("/") || !req.path.includes(".");

  const proxy = http.request(options, (proxyRes) => {
    res.status(proxyRes.statusCode ?? 200);
    Object.entries(proxyRes.headers).forEach(([k, v]) => {
      if (k === "content-length") return; // may change after rewrite
      if (k === "content-security-policy") return; // relax CSP
      if (v !== undefined) res.setHeader(k, v);
    });

    const contentType = String(proxyRes.headers["content-type"] ?? "");
    const isJs = contentType.includes("javascript") || req.path.match(/\.(js|ts|tsx|jsx|mjs)$/);
    if (isHtml || contentType.includes("text/html")) {
      let body = "";
      proxyRes.setEncoding("utf8");
      proxyRes.on("data", (chunk: string) => { body += chunk; });
      proxyRes.on("end", () => {
        // Rewrite absolute paths to go through proxy
        body = body.replace(/(src|href|action)=(["'])\//g, `$1=$2${proxyBase}/`);
        body = body.replace(/from (["'])\//g, `from $1${proxyBase}/`);
        res.end(body);
      });
    } else if (isJs) {
      let body = "";
      proxyRes.setEncoding("utf8");
      proxyRes.on("data", (chunk: string) => { body += chunk; });
      proxyRes.on("end", () => {
        // Rewrite Vite's absolute-path imports (/@vite/client, /@react-refresh, /@id/...)
        // so they route through this proxy instead of hitting the main Vite server.
        body = body.replace(/from (["'])\/([@/])/g, `from $1${proxyBase}/$2`);
        body = body.replace(/import (["'])\/([@/])/g, `import $1${proxyBase}/$2`);
        body = body.replace(/"url":(["'])\//g, `"url":$1${proxyBase}/`);
        body = body.replace(/new URL\((["'])\//g, `new URL($1${proxyBase}/`);
        res.end(body);
      });
    } else {
      proxyRes.pipe(res);
    }
  });

  proxy.on("error", () => res.status(502).send("Live preview proxy error"));
  req.pipe(proxy);
});

// WebSocket proxy — tunnels HMR upgrades through to the session's Vite dev server.
// URL pattern: /api/projects/:pid/sessions/:sid/preview/live/proxy/...
const WS_PROXY_RE = /^\/api\/projects\/([^/]+)\/sessions\/([^/]+)\/preview\/live\/proxy(\/.*)?$/;

export function attachPreviewWsProxy(server: http.Server): void {
  server.on("upgrade", (req: http.IncomingMessage, socket: net.Socket, head: Buffer) => {
    const url = req.url ?? "";
    const m = WS_PROXY_RE.exec(url);
    if (!m) return; // not a preview proxy URL — leave to other handlers

    const [, pid, sid, rest] = m;
    const liveState = getLivePreviewState(pid, sid);

    if (!liveState?.port || (liveState.status !== "running" && liveState.status !== "starting")) {
      socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
      socket.destroy();
      return;
    }

    // Rewrite the path so Vite sees the original path, not the proxy prefix
    const targetPath = rest || "/";

    // Rebuild the HTTP upgrade request line + headers for Vite
    const headerLines = [`GET ${targetPath} HTTP/1.1`, `Host: 127.0.0.1:${liveState.port}`];
    for (const [k, v] of Object.entries(req.headers)) {
      if (k.toLowerCase() === "host") continue; // already added above
      if (Array.isArray(v)) v.forEach((vv) => headerLines.push(`${k}: ${vv}`));
      else headerLines.push(`${k}: ${v}`);
    }
    const upgradeRequest = headerLines.join("\r\n") + "\r\n\r\n";

    const upstream = net.connect(liveState.port, "127.0.0.1", () => {
      upstream.write(upgradeRequest);
      if (head.length > 0) upstream.write(head);
    });

    upstream.on("error", () => {
      socket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
      socket.destroy();
    });

    socket.on("error", () => upstream.destroy());
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
}
