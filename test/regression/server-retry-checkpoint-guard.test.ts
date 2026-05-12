import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { Request, Response, NextFunction } from "express";

import { nodeRouter } from "../../apps/server/src/routes/node";
import { createProject, createSession } from "../../packages/core/src/persistence/project";

function getRouteHandler(routePath: string, method: "post") {
  const layer = (nodeRouter as unknown as { stack?: Array<{ route?: { path?: string; methods?: Record<string, boolean>; stack?: Array<{ handle: Function }> } }> }).stack
    ?.find((entry) => entry.route?.path === routePath && entry.route?.methods?.[method]);

  const handler = layer?.route?.stack?.[0]?.handle;
  if (!handler) throw new Error(`Route handler not found: ${method.toUpperCase()} ${routePath}`);
  return handler as (req: Request, res: Response, next: NextFunction) => void | Promise<void>;
}

async function invokeJsonRoute(
  routePath: string,
  method: "post",
  req: Partial<Request>
): Promise<{ status: number; body: unknown }> {
  const handler = getRouteHandler(routePath, method);

  return await new Promise((resolve, reject) => {
    const response = {
      statusCode: 200,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(body: unknown) {
        resolve({ status: this.statusCode, body });
        return this;
      },
    } as unknown as Response & { statusCode: number };

    Promise.resolve(
      handler(req as Request, response as Response, ((err?: unknown) => err ? reject(err) : undefined) as NextFunction)
    ).catch(reject);
  });
}

test("server: session retry returns helpful conflict when session exists but graph checkpoint is missing", async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipyard-server-retry-session-"));
  const previousWorkDir = process.env.WORK_DIR;
  process.env.WORK_DIR = workDir;

  try {
    const project = createProject(workDir, "Test Project");
    const session = createSession(workDir, project.id, "spec");
    const result = await invokeJsonRoute("/session/retry", "post", {
      body: {
        projectId: project.id,
        sessionId: session.id,
      },
      params: {},
    });

    assert.equal(result.status, 409);
    assert.match(String((result.body as { error?: string }).error ?? ""), /no saved execution graph yet/i);
  } finally {
    if (previousWorkDir === undefined) delete process.env.WORK_DIR;
    else process.env.WORK_DIR = previousWorkDir;
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test("server: node retry returns helpful conflict when session exists but graph checkpoint is missing", async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipyard-server-retry-node-"));
  const previousWorkDir = process.env.WORK_DIR;
  process.env.WORK_DIR = workDir;

  try {
    const project = createProject(workDir, "Test Project");
    const session = createSession(workDir, project.id, "spec");
    const result = await invokeJsonRoute("/node/:id/retry", "post", {
      body: {
        projectId: project.id,
        sessionId: session.id,
      },
      params: { id: "fake-node" },
    });

    assert.equal(result.status, 409);
    assert.match(String((result.body as { error?: string }).error ?? ""), /never produced a saved execution graph/i);
  } finally {
    if (previousWorkDir === undefined) delete process.env.WORK_DIR;
    else process.env.WORK_DIR = previousWorkDir;
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});
