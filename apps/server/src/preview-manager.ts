import * as fs from "fs";
import * as net from "net";
import * as path from "path";
import { spawn, type ChildProcess } from "child_process";
import type { LivePreviewStatus } from "./types";

const DEBUG_PREFIX = "[shipyard:server:preview-live]";

export interface LivePreviewCapability {
  supported: boolean;
  reason?: string;
  command?: string;
  packageJsonPath?: string;
}

interface PreviewCommand {
  command: string;
  args: string[];
  display: string;
}

interface LivePreviewState {
  status: LivePreviewStatus;
  port?: number;
  url?: string;
  command?: string;
  error?: string;
  child?: ChildProcess | null;
}

const livePreviewStates = new Map<string, LivePreviewState>();

function makeKey(projectId: string, sessionId: string): string {
  return `${projectId}:${sessionId}`;
}

function readPackageJson(outputDir: string): Record<string, unknown> | null {
  const packageJsonPath = path.join(outputDir, "package.json");
  if (!fs.existsSync(packageJsonPath)) return null;

  try {
    return JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function buildCommandForOutput(outputDir: string, port: number): PreviewCommand | null {
  const packageJson = readPackageJson(outputDir);
  if (!packageJson) return null;

  const scripts = (packageJson.scripts as Record<string, unknown> | undefined) ?? {};
  const dependencies = {
    ...((packageJson.dependencies as Record<string, unknown> | undefined) ?? {}),
    ...((packageJson.devDependencies as Record<string, unknown> | undefined) ?? {}),
  };

  const previewScript = typeof scripts.preview === "string" ? scripts.preview : null;
  const devScript = typeof scripts.dev === "string" ? scripts.dev : null;
  const hasVite = "vite" in dependencies || (previewScript?.includes("vite") ?? false) || (devScript?.includes("vite") ?? false);
  const hasNext = "next" in dependencies || (devScript?.includes("next") ?? false);

  if (previewScript && hasVite) {
    return {
      command: "pnpm",
      args: ["preview", "--", "--host", "127.0.0.1", "--port", String(port)],
      display: `pnpm preview -- --host 127.0.0.1 --port ${port}`,
    };
  }

  if (devScript && hasVite) {
    return {
      command: "pnpm",
      args: ["dev", "--", "--host", "127.0.0.1", "--port", String(port)],
      display: `pnpm dev -- --host 127.0.0.1 --port ${port}`,
    };
  }

  if (hasNext) {
    return {
      command: "pnpm",
      args: ["exec", "next", "dev", "-H", "127.0.0.1", "-p", String(port)],
      display: `pnpm exec next dev -H 127.0.0.1 -p ${port}`,
    };
  }

  return null;
}

export function getLivePreviewCapability(outputDir: string): LivePreviewCapability {
  const packageJsonPath = path.join(outputDir, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    return {
      supported: false,
      reason: "No package.json found for live preview.",
    };
  }

  const command = buildCommandForOutput(outputDir, 4173);
  if (!command) {
    return {
      supported: false,
      reason: "Live preview currently supports Vite preview/dev or Next.js dev projects.",
      packageJsonPath,
    };
  }

  return {
    supported: true,
    command: command.display.replace(/4173/, "<port>"),
    packageJsonPath,
  };
}

export function getLivePreviewState(projectId: string, sessionId: string): LivePreviewState | null {
  return livePreviewStates.get(makeKey(projectId, sessionId)) ?? null;
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

function waitForPort(port: number, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const socket = net.createConnection({ port, host: "127.0.0.1" });
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() >= deadline) {
          reject(new Error(`Timed out waiting for preview server on port ${port}`));
        } else {
          setTimeout(tryConnect, 500);
        }
      });
    };

    tryConnect();
  });
}

function runInstall(outputDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["install", "--frozen-lockfile=false"], {
      cwd: outputDir,
      env: { ...process.env, CI: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk) => console.log(DEBUG_PREFIX, "install:stdout", chunk.toString().trim()));
    child.stderr.on("data", (chunk) => console.log(DEBUG_PREFIX, "install:stderr", chunk.toString().trim()));

    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pnpm install exited with code ${code ?? -1}`));
    });
    child.once("error", reject);
  });
}

async function launchLivePreview(
  projectId: string,
  sessionId: string,
  outputDir: string,
  port: number,
  command: PreviewCommand
): Promise<void> {
  const key = makeKey(projectId, sessionId);
  const state = livePreviewStates.get(key);
  if (!state) return;

  const packageJsonPath = path.join(outputDir, "package.json");
  const nodeModulesPath = path.join(outputDir, "node_modules");

  try {
    if (fs.existsSync(packageJsonPath) && !fs.existsSync(nodeModulesPath)) {
      console.log(DEBUG_PREFIX, "install:start", { projectId, sessionId, outputDir });
      await runInstall(outputDir);
      console.log(DEBUG_PREFIX, "install:done", { projectId, sessionId });
    }

    const child = spawn(command.command, command.args, {
      cwd: outputDir,
      env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", CI: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    state.child = child;
    state.command = command.display;
    state.port = port;
    state.url = `http://127.0.0.1:${port}`;
    state.error = undefined;
    livePreviewStates.set(key, state);

    child.stdout.on("data", (chunk) => console.log(DEBUG_PREFIX, "stdout", { projectId, sessionId, line: chunk.toString().trim() }));
    child.stderr.on("data", (chunk) => console.log(DEBUG_PREFIX, "stderr", { projectId, sessionId, line: chunk.toString().trim() }));

    child.once("exit", (code, signal) => {
      const current = livePreviewStates.get(key);
      if (!current || current.child !== child) return;
      if (current.status === "idle") return;
      current.child = null;
      if (current.status === "running") {
        current.status = "error";
        current.error = `Preview process exited unexpectedly (${code ?? signal ?? "unknown"}).`;
      } else if (current.status === "starting") {
        current.status = "error";
        current.error = `Preview failed to start (${code ?? signal ?? "unknown"}).`;
      }
      livePreviewStates.set(key, current);
    });

    child.once("error", (error) => {
      const current = livePreviewStates.get(key);
      if (!current) return;
      current.child = null;
      current.status = "error";
      current.error = error.message;
      livePreviewStates.set(key, current);
    });

    await waitForPort(port);
    const current = livePreviewStates.get(key);
    if (!current) return;
    current.status = "running";
    current.error = undefined;
    livePreviewStates.set(key, current);
    console.log(DEBUG_PREFIX, "running", { projectId, sessionId, url: current.url, command: current.command });
  } catch (error) {
    const current = livePreviewStates.get(key);
    if (!current) return;
    current.child?.kill("SIGTERM");
    current.child = null;
    current.status = "error";
    current.error = (error as Error).message;
    livePreviewStates.set(key, current);
    console.log(DEBUG_PREFIX, "error", { projectId, sessionId, error: current.error });
  }
}

export async function startLivePreview(projectId: string, sessionId: string, outputDir: string): Promise<LivePreviewState> {
  const key = makeKey(projectId, sessionId);
  const existing = livePreviewStates.get(key);
  if (existing && (existing.status === "starting" || existing.status === "running")) {
    return existing;
  }

  const port = existing?.port ?? await findFreePort();
  const command = buildCommandForOutput(outputDir, port);
  if (!command) {
    const unsupported: LivePreviewState = {
      status: "error",
      error: "Live preview is not supported for this session output.",
    };
    livePreviewStates.set(key, unsupported);
    return unsupported;
  }

  const nextState: LivePreviewState = {
    status: "starting",
    port,
    url: `http://127.0.0.1:${port}`,
    command: command.display,
    error: undefined,
    child: null,
  };
  livePreviewStates.set(key, nextState);
  void launchLivePreview(projectId, sessionId, outputDir, port, command);
  return nextState;
}

export function stopLivePreview(projectId: string, sessionId: string): LivePreviewState {
  const key = makeKey(projectId, sessionId);
  const current = livePreviewStates.get(key) ?? { status: "idle" as const };
  current.child?.kill("SIGTERM");
  current.child = null;
  current.status = "idle";
  current.error = undefined;
  livePreviewStates.set(key, current);
  console.log(DEBUG_PREFIX, "stopped", { projectId, sessionId });
  return current;
}

process.on("exit", () => {
  for (const state of livePreviewStates.values()) {
    state.child?.kill("SIGTERM");
  }
});
