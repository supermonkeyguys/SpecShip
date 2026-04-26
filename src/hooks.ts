/**
 * hooks.ts — 执行过程中的副作用处理
 * 不再依赖 Agent SDK，直接在 llm.ts 的 onToolCall 回调里使用
 */

import * as fs from "fs";
import * as path from "path";

/** 审计日志：记录所有文件写入 */
export function auditWrite(filePath: string, workDir: string): void {
  const normalizedPath = path.isAbsolute(filePath)
    ? path.relative(workDir, filePath).replace(/\\/g, "/")
    : filePath;
  const logLine = `${new Date().toISOString()} WRITE ${normalizedPath}\n`;
  fs.appendFileSync(path.join(workDir, ".shipyard-audit.log"), logLine);
}

/** 路径安全检查：只允许写 workDir 内 */
export function isPathSafe(filePath: string, workDir: string): boolean {
  const allowed = path.resolve(workDir);
  const resolved = path.resolve(workDir, filePath);
  const relative = path.relative(allowed, resolved);

  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
