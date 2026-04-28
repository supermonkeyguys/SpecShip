/**
 * run-workflow.ts — Temporal Client 入口
 *
 * 供 API server 调用，屏蔽 Temporal SDK 细节。
 * server 只 import 这个文件，不直接依赖 @temporalio/client。
 */

import { Client, Connection } from "@temporalio/client";
import { SpecRunWorkflow } from "../workflows/spec-run.workflow";

export interface StartWorkflowOptions {
  spec: string;
  projectId: string;
  sessionId: string;
  workDir: string;
  repoPath?: string;
  temporalAddress?: string;
  taskQueue?: string;
}

export interface WorkflowResult {
  status: "done" | "failed" | "cancelled" | "running";
  nodeStatuses: Record<string, string>;
}

export async function startSpecRunWorkflow(opts: StartWorkflowOptions): Promise<WorkflowResult> {
  const address   = opts.temporalAddress ?? process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
  const taskQueue = opts.taskQueue ?? process.env.TEMPORAL_TASK_QUEUE ?? "specship-main";

  const connection = await Connection.connect({ address });
  const client = new Client({ connection });

  const workflowId = `specship:${opts.projectId}:${opts.sessionId}`;

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

  await connection.close();

  return {
    status: summary.status,
    nodeStatuses: summary.nodeStatuses as Record<string, string>,
  };
}
