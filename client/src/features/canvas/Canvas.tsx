/**
 * Canvas.tsx — 中间画板（React Flow DAG）
 */

import { useMemo, useState } from "react";
import ReactFlow, {
  type Node,
  type Edge,
  Background,
  Controls,
  MarkerType,
} from "reactflow";
import "reactflow/dist/style.css";
import { useGraphStore } from "../../store/graph";
import type { NodeStatus } from "../../../../server/types";

const STATUS_COLORS: Record<NodeStatus["status"], string> = {
  pending:   "#9ca3af",
  ready:     "#3b82f6",
  running:   "#f59e0b",
  verifying: "#8b5cf6",
  done:      "#16a34a",
  failed:    "#dc2626",
  blocked:   "#d1d5db",
  skipped:   "#d1d5db",
};

const STATUS_BG: Record<NodeStatus["status"], string> = {
  pending:   "#f9fafb",
  ready:     "#eff6ff",
  running:   "#fffbeb",
  verifying: "#faf5ff",
  done:      "#f0fdf4",
  failed:    "#fef2f2",
  blocked:   "#f3f4f6",
  skipped:   "#f3f4f6",
};

export function Canvas() {
  const nodes = useGraphStore((s) => s.nodes);
  const [selected, setSelected] = useState<NodeStatus | null>(null);

  const { rfNodes, rfEdges } = useMemo(() => {
    const nodeList = Object.values(nodes);
    const cols = Math.ceil(Math.sqrt(nodeList.length)) || 1;

    const rfNodes: Node[] = nodeList.map((n, i) => ({
      id: n.id,
      position: { x: (i % cols) * 260, y: Math.floor(i / cols) * 160 },
      data: { label: <NodeCard node={n} /> },
      style: {
        border: `1.5px solid ${STATUS_COLORS[n.status]}`,
        borderRadius: 8,
        background: STATUS_BG[n.status],
        padding: 0,
        width: 220,
        boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
      },
    }));

    const rfEdges: Edge[] = nodeList.flatMap((n) =>
      n.dependsOn.map((dep) => ({
        id: `${dep}->${n.id}`,
        source: dep,
        target: n.id,
        animated: n.status === "running",
        style: { stroke: "#6b7280", strokeWidth: 1.5 },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: "#6b7280",
          width: 16,
          height: 16,
        },
      }))
    );

    return { rfNodes, rfEdges };
  }, [nodes]);

  return (
    <div className="relative w-full h-full bg-white">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        fitView
        nodesDraggable={false}
        nodesConnectable={false}
        onNodeClick={(_, node) => setSelected(nodes[node.id] ?? null)}
        defaultEdgeOptions={{
          style: { stroke: "#6b7280", strokeWidth: 1.5 },
          markerEnd: { type: MarkerType.ArrowClosed, color: "#6b7280", width: 16, height: 16 },
        }}
      >
        <Background color="#000000" gap={20} />
        <Controls />
      </ReactFlow>

      {selected && (
        <NodeDetail node={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

function NodeCard({ node }: { node: NodeStatus }) {
  const color = STATUS_COLORS[node.status];
  const isRunning = node.status === "running" || node.status === "verifying";

  return (
    <div className="p-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="relative flex-shrink-0 w-2 h-2">
          {isRunning && (
            <span
              className="absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping"
              style={{ background: color }}
            />
          )}
          <span
            className="relative inline-flex rounded-full w-2 h-2"
            style={{ background: color }}
          />
        </span>
        <span className="text-gray-800 text-xs font-semibold truncate">{node.title}</span>
      </div>
      <div className="text-gray-500 text-xs truncate">{node.specFragment.slice(0, 60)}</div>
      {node.retryCount > 0 && (
        <div className="text-amber-600 text-xs mt-1">↺ retry {node.retryCount}</div>
      )}
      {node.durationMs && node.status === "done" && (
        <div className="text-gray-400 text-xs mt-1">{(node.durationMs / 1000).toFixed(1)}s</div>
      )}
    </div>
  );
}

function NodeDetail({ node, onClose }: { node: NodeStatus; onClose: () => void }) {
  return (
    <div className="absolute top-4 right-4 w-80 bg-white border border-gray-200 rounded-xl shadow-lg p-4 z-10">
      <div className="flex justify-between items-start mb-3">
        <h3 className="text-gray-900 font-semibold text-sm">{node.title}</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-lg leading-none">×</button>
      </div>

      <div className="space-y-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-gray-500">Status</span>
          <span
            className="px-2 py-0.5 rounded-full text-white text-xs font-medium"
            style={{ background: STATUS_COLORS[node.status] }}
          >
            {node.status}
          </span>
          {node.durationMs && (
            <span className="text-gray-400 ml-auto">{(node.durationMs / 1000).toFixed(1)}s</span>
          )}
        </div>

        {node.filesWritten.length > 0 && (
          <div>
            <div className="text-gray-500 mb-1 font-medium">Files</div>
            {node.filesWritten.map((f) => (
              <div key={f} className="text-green-700 font-mono pl-2">📄 {f}</div>
            ))}
          </div>
        )}

        {node.verifications.length > 0 && (
          <div>
            <div className="text-gray-500 mb-1 font-medium">Verifications</div>
            {node.verifications.map((v, i) => (
              <div key={i} className="pl-2 flex gap-1">
                <span className={v.passed ? "text-green-600" : "text-red-500"}>
                  {v.passed ? "✓" : "✗"}
                </span>
                <span className="text-gray-600">[{v.type}] {v.summary}</span>
              </div>
            ))}
          </div>
        )}

        {node.error && (
          <div>
            <div className="text-gray-500 mb-1 font-medium">Error</div>
            <div className="text-red-600 pl-2 font-mono break-all bg-red-50 rounded p-2">{node.error}</div>
          </div>
        )}
      </div>
    </div>
  );
}
