/**
 * run-workflow.ts — Temporal Client 入口
 *
 * 供 API server 调用，屏蔽 Temporal SDK 细节。
 * server 只 import 这个文件，不直接依赖 @temporalio/client。
 */

import { Client, Connection } from "@temporalio/client";
import {
  SpecRunWorkflow,
  getRunSummaryQuery,
  retryNodeSignal,
  resumeRunSignal,
  type RunSummary,
} from "../workflows/spec-run.workflow";

export interface StartWorkflowOptions {
  spec: string;
  projectId: string;
  sessionId: string;
  workDir: string;
  repoPath?: string;
  temporalAddress?: string;
  taskQueue?: string;
}

export interface WorkflowHandleOptions {
  workflowId: string;
  temporalAddress?: string;
}

export interface RetryNodeSignalOptions extends WorkflowHandleOptions {
  nodeId: string;
}

export interface WorkflowResult {
  status: "done" | "failed" | "cancelled" | "running";
  nodeStatuses: Record<string, string>;
}

function resolveAddress(address?: string): string {
  return address ?? process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
}

function resolveTaskQueue(taskQueue?: string): string {
  return taskQueue ?? process.env.TEMPORAL_TASK_QUEUE ?? "specship-main";
}

export function buildWorkflowId(projectId: string, sessionId: string): string {
  return `specship:${projectId}:${sessionId}`;
}

export async function startSpecRunWorkflow(opts: StartWorkflowOptions): Promise<WorkflowResult> {
  const address = resolveAddress(opts.temporalAddress);
  const taskQueue = resolveTaskQueue(opts.taskQueue);

  const connection = await Connection.connect({ address });
  const client = new Client({ connection });

  const workflowId = buildWorkflowId(opts.projectId, opts.sessionId);

  try {
    const summary = await client.workflow.execute(SpecRunWorkflow, {
      taskQueue,
      workflowId,
      args: [{
        spec: opts.spec,
        projectId: opts.projectId,
        sessionId: opts.sessionId,
        workDir: opts.workDir,
        repoPath: opts.repoPath,
      }],
    });

    return {
      status: summary.status,
      nodeStatuses: summary.nodeStatuses as Record<string, string>,
    };
  } finally {
    await connection.close();
  }
}

export async function querySpecRunSummary(opts: WorkflowHandleOptions): Promise<RunSummary> {
  const address = resolveAddress(opts.temporalAddress);
  const connection = await Connection.connect({ address });
  const client = new Client({ connection });

  try {
    const handle = client.workflow.getHandle(opts.workflowId);
    return await handle.query(getRunSummaryQuery);
  } finally {
    await connection.close();
  }
}

export async function signalRetryNode(opts: RetryNodeSignalOptions): Promise<void> {
  const address = resolveAddress(opts.temporalAddress);
  const connection = await Connection.connect({ address });
  const client = new Client({ connection });

  try {
    const handle = client.workflow.getHandle(opts.workflowId);
    await handle.signal(retryNodeSignal, opts.nodeId);
  } finally {
    await connection.close();
  }
}

export async function signalResumeRun(opts: WorkflowHandleOptions & { reason?: string }): Promise<void> {
  const address = resolveAddress(opts.temporalAddress);
  const connection = await Connection.connect({ address });
  const client = new Client({ connection });

  try {
    const handle = client.workflow.getHandle(opts.workflowId);
    await handle.signal(resumeRunSignal, opts.reason ?? "resume via API");
  } finally {
    await connection.close();
  }
}
