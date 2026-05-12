/**
 * execution-logger.ts
 *
 * 把执行过程的关键事件写入 session 目录下的 execution.log.jsonl
 * 每行一个 JSON 事件，便于事后分析 / postmortem
 */

import * as fs from "fs";
import * as path from "path";

export type LogEvent =
  | { event: "plan_complete"; title: string; nodeCount: number; nodes: Array<{ id: string; title: string; nodeRole: string; task: string; acceptanceCriteria: string; dependsOn: string[]; outputFile: string }> }
  | { event: "node_start"; nodeId: string; title: string; nodeRole: string; task: string; retryCount: number; selectedModel?: string; routeReason?: string; complexity?: string; risk?: string }
  | { event: "node_prompt"; nodeId: string; prompt: string; selectedModel?: string; routeReason?: string; complexity?: string; risk?: string }
  | { event: "verify_result"; nodeId: string; passed: boolean; errors: string }
  | { event: "review_input"; nodeId: string; criteria: string; role: string; task: string; codeSnippet: string }
  | { event: "review_result"; nodeId: string; passed: boolean; blocking: string[]; warnings: string[]; summary: string }
  | { event: "node_retry"; nodeId: string; retryCount: number; maxRetries: number; reason: "fatal" | "verify" | "review" | "unknown" }
  | { event: "node_done"; nodeId: string; durationMs: number; filesWritten: string[] }
  | { event: "node_failed"; nodeId: string; durationMs: number; reason: string; lastError: string }
  | { event: "session_done"; status: "done" | "failed"; totalMs: number; doneCount: number; failedCount: number };

export class ExecutionLogger {
  private logPath: string;
  private sessionStart: number;

  constructor(workDir: string, projectId: string, sessionId: string) {
    const sessionDir = path.join(workDir, ".shipyard", "projects", projectId, "sessions", sessionId);
    fs.mkdirSync(sessionDir, { recursive: true });
    this.logPath = path.join(sessionDir, "execution.log.jsonl");
    this.sessionStart = Date.now();
    // 每次新运行清空旧日志
    fs.writeFileSync(this.logPath, "");
  }

  log(entry: LogEvent): void {
    const line = JSON.stringify({ ts: new Date().toISOString(), elapsedMs: Date.now() - this.sessionStart, ...entry });
    try {
      fs.appendFileSync(this.logPath, line + "\n");
    } catch {
      // 日志写失败不影响主流程
    }
  }
}
