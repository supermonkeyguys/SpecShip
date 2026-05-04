import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  appendSessionOperation,
  getSessionRevision,
  readSessionOperations,
  RevisionConflictError,
} from "../../packages/core/src/persistence/op-log";
import { replaySessionOperations } from "../../packages/core/src/persistence/op-replay";
import { createProject, createSession } from "../../packages/core/src/persistence/project";
import type { SessionOperationV1 } from "../../packages/shared/src/types";

function makeWorkDir(): { workDir: string; cleanup: () => void } {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipyard-op-events-"));
  return {
    workDir,
    cleanup: () => fs.rmSync(workDir, { recursive: true, force: true }),
  };
}

test("op-log: appends operations in revision order", () => {
  const { workDir, cleanup } = makeWorkDir();

  try {
    const project = createProject(workDir, "events-test");
    const session = createSession(workDir, project.id, "spec");

    const op1 = appendSessionOperation(
      workDir,
      {
        v: 1,
        projectId: project.id,
        sessionId: session.id,
        actor: "server",
        source: "run",
        type: "session.created",
        payload: { spec: "spec" },
      },
      0
    );

    const op2 = appendSessionOperation(
      workDir,
      {
        v: 1,
        projectId: project.id,
        sessionId: session.id,
        actor: "server",
        source: "run",
        type: "session.status_set",
        payload: { status: "running" },
      },
      1
    );

    const ops = readSessionOperations(workDir, project.id, session.id);

    assert.equal(op1.sessionRevision, 1);
    assert.equal(op2.sessionRevision, 2);
    assert.equal(ops.length, 2);
    assert.equal(ops[0]?.type, "session.created");
    assert.equal(ops[1]?.type, "session.status_set");
    assert.equal(getSessionRevision(workDir, project.id, session.id), 2);
  } finally {
    cleanup();
  }
});

test("op-log: rejects stale expected revision", () => {
  const { workDir, cleanup } = makeWorkDir();

  try {
    const project = createProject(workDir, "events-conflict");
    const session = createSession(workDir, project.id, "spec");

    appendSessionOperation(
      workDir,
      {
        v: 1,
        projectId: project.id,
        sessionId: session.id,
        actor: "server",
        source: "run",
        type: "session.created",
        payload: { spec: "spec" },
      },
      0
    );

    let conflict: RevisionConflictError | null = null;
    try {
      appendSessionOperation(
        workDir,
        {
          v: 1,
          projectId: project.id,
          sessionId: session.id,
          actor: "server",
          source: "run",
          type: "session.status_set",
          payload: { status: "running" },
        },
        0
      );
    } catch (error) {
      conflict = error as RevisionConflictError;
    }

    assert.ok(conflict instanceof RevisionConflictError);
    assert.equal(conflict?.expectedRevision, 0);
    assert.equal(conflict?.actualRevision, 1);

    const ops = readSessionOperations(workDir, project.id, session.id);
    assert.equal(ops.length, 1);
  } finally {
    cleanup();
  }
});

test("op-replay: ignores duplicate opId and keeps final projection", () => {
  const baseAt = new Date().toISOString();
  const ops: SessionOperationV1[] = [
    {
      v: 1,
      opId: "op-1",
      projectId: "p1",
      sessionId: "s1",
      sessionRevision: 1,
      at: baseAt,
      actor: "server",
      source: "run",
      type: "graph.initialized",
      payload: { graphId: "g1", title: "title", status: "running" },
    },
    {
      v: 1,
      opId: "op-2",
      projectId: "p1",
      sessionId: "s1",
      sessionRevision: 2,
      at: baseAt,
      actor: "system",
      source: "scheduler",
      type: "node.status_set",
      payload: { nodeId: "n1", status: "failed", retryCount: 1, maxRetries: 2, error: "boom" },
    },
    {
      v: 1,
      opId: "op-3",
      projectId: "p1",
      sessionId: "s1",
      sessionRevision: 3,
      at: baseAt,
      actor: "user",
      source: "retry",
      type: "node.retry_scheduled",
      payload: { nodeId: "n1", retryCount: 2, maxRetries: 2 },
    },
    {
      v: 1,
      opId: "op-3",
      projectId: "p1",
      sessionId: "s1",
      sessionRevision: 3,
      at: baseAt,
      actor: "user",
      source: "retry",
      type: "node.retry_scheduled",
      payload: { nodeId: "n1", retryCount: 999, maxRetries: 999 },
    },
    {
      v: 1,
      opId: "op-4",
      projectId: "p1",
      sessionId: "s1",
      sessionRevision: 4,
      at: baseAt,
      actor: "system",
      source: "scheduler",
      type: "node.status_set",
      payload: { nodeId: "n1", status: "done", retryCount: 2, maxRetries: 2 },
    },
    {
      v: 1,
      opId: "op-5",
      projectId: "p1",
      sessionId: "s1",
      sessionRevision: 5,
      at: baseAt,
      actor: "system",
      source: "scheduler",
      type: "graph.completed",
      payload: { graphId: "g1" },
    },
  ];

  const projection = replaySessionOperations(ops);

  assert.equal(projection.projectId, "p1");
  assert.equal(projection.sessionId, "s1");
  assert.equal(projection.revision, 5);
  assert.equal(projection.graph.id, "g1");
  assert.equal(projection.graph.status, "done");
  assert.equal(projection.sessionStatus, "done");

  const node = projection.nodes["n1"];
  assert.ok(node);
  assert.equal(node?.status, "done");
  assert.equal(node?.retryCount, 2);
  assert.equal(node?.maxRetries, 2);
}
);
