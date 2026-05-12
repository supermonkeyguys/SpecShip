import type { RefObject } from "react";
import type { NodeStatus } from "../../../types";

interface Props {
  nodeList: NodeStatus[];
  logs: string[];
  bottomRef: RefObject<HTMLDivElement | null>;
}

export function LogPanelView({ nodeList, logs, bottomRef }: Props) {
  return (
    <div className="flex-1 overflow-y-auto p-3 font-mono text-xs space-y-2">
      {nodeList.map((node) => (
        <div key={node.id} className="space-y-0.5">
          <div className={`flex items-center gap-2 ${statusColor(node.status)}`}>
            <span className="font-semibold">[{node.status.toUpperCase()}]</span>
            <span className="text-gray-700">{node.title}</span>
            {node.durationMs && (
              <span className="text-gray-400 ml-auto">{(node.durationMs / 1000).toFixed(1)}s</span>
            )}
          </div>
          {node.verifications.map((verification, index) => (
            <div
              key={index}
              className={`pl-4 ${verification.passed ? "text-green-600" : "text-red-500"}`}
            >
              {verification.passed ? "✓" : "✗"} [{verification.type}] {verification.summary}
            </div>
          ))}
          {node.filesWritten.map((file, index) => (
            <div key={index} className="pl-4 text-gray-400">
              → {file}
            </div>
          ))}
          {(node.toolCalls ?? []).map((toolCall, index) => (
            <details key={`${node.id}-tool-${index}`} className="pl-4 text-gray-500">
              <summary className="cursor-pointer select-none">
                {toolCall.success ? "🛠" : "⚠"} {toolCall.tool} {toolCall.success ? "ok" : "failed"}
              </summary>
              <div className="mt-1 space-y-1 text-[11px] text-gray-500">
                <div className="break-all">input: {JSON.stringify(toolCall.input)}</div>
                <div className="break-all">output: {toolCall.output}</div>
              </div>
            </details>
          ))}
          {node.error && <div className="pl-4 text-red-500 break-all">{node.error}</div>}
        </div>
      ))}
      {logs.map((log, index) => (
        <div key={index} className="text-gray-400">
          {log}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

function statusColor(status: string): string {
  const map: Record<string, string> = {
    running: "text-amber-600",
    done: "text-green-600",
    failed: "text-red-500",
    verifying: "text-purple-600",
    blocked: "text-gray-400",
  };
  return map[status] ?? "text-gray-500";
}
