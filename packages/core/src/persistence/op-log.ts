import * as fs from "fs";
import { randomUUID } from "crypto";
import type { SessionOperationV1 } from "../../../shared/src/types";
import { getSessionEventsDir, getSessionOperationsLogPath } from "./project";

export class RevisionConflictError extends Error {
  constructor(
    public readonly projectId: string,
    public readonly sessionId: string,
    public readonly expectedRevision: number,
    public readonly actualRevision: number
  ) {
    super(
      `Session revision conflict for ${projectId}/${sessionId}: expected ${expectedRevision}, actual ${actualRevision}`
    );
    this.name = "RevisionConflictError";
  }
}

export type SessionOperationWriteInput = Omit<SessionOperationV1, "sessionRevision" | "at" | "opId"> & {
  at?: string;
  opId?: string;
};

export function readSessionOperations(workDir: string, projectId: string, sessionId: string): SessionOperationV1[] {
  const logPath = getSessionOperationsLogPath(workDir, projectId, sessionId);
  if (!fs.existsSync(logPath)) return [];

  const raw = fs.readFileSync(logPath, "utf-8");
  if (!raw.trim()) return [];

  const ops: SessionOperationV1[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      ops.push(JSON.parse(trimmed) as SessionOperationV1);
    } catch {
      // 保持 append-only 日志容错：跳过坏行，后续可由诊断工具处理
    }
  }

  return ops;
}

export function getSessionRevision(workDir: string, projectId: string, sessionId: string): number {
  const ops = readSessionOperations(workDir, projectId, sessionId);
  return ops.length === 0 ? 0 : ops[ops.length - 1]!.sessionRevision;
}

export function appendSessionOperation(
  workDir: string,
  operation: SessionOperationWriteInput,
  expectedRevision: number
): SessionOperationV1 {
  const currentRevision = getSessionRevision(workDir, operation.projectId, operation.sessionId);
  if (currentRevision !== expectedRevision) {
    throw new RevisionConflictError(
      operation.projectId,
      operation.sessionId,
      expectedRevision,
      currentRevision
    );
  }

  const eventsDir = getSessionEventsDir(workDir, operation.projectId, operation.sessionId);
  fs.mkdirSync(eventsDir, { recursive: true });

  const fullOperation: SessionOperationV1 = {
    ...operation,
    v: 1,
    opId: operation.opId ?? randomUUID(),
    at: operation.at ?? new Date().toISOString(),
    sessionRevision: expectedRevision + 1,
  };

  const logPath = getSessionOperationsLogPath(workDir, operation.projectId, operation.sessionId);
  fs.appendFileSync(logPath, `${JSON.stringify(fullOperation)}\n`, "utf-8");

  return fullOperation;
}
