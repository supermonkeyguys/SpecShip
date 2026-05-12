import type { NodeStatus } from "../../../types";
import {
  ERROR_CATEGORY_LABEL,
  NODE_TYPE_LABEL,
  STATUS_COLORS,
  STATUS_LABEL,
  isNodeActive,
} from "../canvas.constants";

export function NodeCard({ node }: { node: NodeStatus }) {
  const color = STATUS_COLORS[node.status];
  const isRunning = isNodeActive(node);
  const isFailed = node.status === "failed";

  return (
    <div className="p-3">
      <div className="mb-1 flex items-center gap-2">
        <span className="relative h-2 w-2 flex-shrink-0">
          {isRunning && (
            <span
              className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
              style={{ background: color }}
            />
          )}
          <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: color }} />
        </span>
        <span className="flex-1 truncate text-xs font-semibold text-gray-800">{node.title}</span>
        <span className="flex-shrink-0 rounded bg-gray-100 px-1 font-mono text-xs text-gray-400">
          {NODE_TYPE_LABEL[node.nodeType] ?? node.nodeType}
        </span>
      </div>

      <div className="mb-1 flex items-center gap-2">
        <span className="text-xs font-medium" style={{ color }}>
          {STATUS_LABEL[node.status]}
        </span>
        {node.durationMs && <span className="text-xs text-gray-400">{(node.durationMs / 1000).toFixed(1)}s</span>}
        {node.retryCount > 0 && (
          <span className="ml-auto text-xs text-amber-600">
            ↺ {node.retryCount}/{node.maxRetries}
          </span>
        )}
      </div>

      <div className="truncate text-xs text-gray-400">{node.specFragment.slice(0, 60)}</div>

      {isFailed && node.error && (
        <div className="mt-1.5 truncate rounded bg-red-50 px-1.5 py-1 text-xs text-red-600">
          {node.errorCategory ? ERROR_CATEGORY_LABEL[node.errorCategory] : "Error"}: {node.error.slice(0, 60)}
        </div>
      )}
    </div>
  );
}
