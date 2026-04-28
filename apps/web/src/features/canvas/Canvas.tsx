/**
 * Canvas.tsx — 中间画板（React Flow DAG）
 */

import { useMemo, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import ReactFlow, {
  type Node,
  type Edge,
  Background,
  Controls,
  MarkerType,
} from "reactflow";
import "reactflow/dist/style.css";
import {
  Dialog,
  DialogClose,
  DialogPortal,
  DialogTitle,
} from "../../components/ui/dialog";
import { useExecutionStore } from "../../domains/execution/store";
import type { SessionExecutionState } from "../../domains/execution/types";
import type { NodeStatus } from "../../types";

const STATUS_COLORS: Record<NodeStatus["status"], string> = {
  pending: "#9ca3af",
  ready: "#3b82f6",
  running: "#f59e0b",
  verifying: "#8b5cf6",
  done: "#16a34a",
  failed: "#dc2626",
  blocked: "#d1d5db",
  skipped: "#d1d5db",
};

const STATUS_BG: Record<NodeStatus["status"], string> = {
  pending: "#f9fafb",
  ready: "#eff6ff",
  running: "#fffbeb",
  verifying: "#faf5ff",
  done: "#f0fdf4",
  failed: "#fef2f2",
  blocked: "#f3f4f6",
  skipped: "#f3f4f6",
};

const EMPTY_NODES: SessionExecutionState["nodes"] = {};

export function Canvas() {
  const execution = useExecutionStore((state) => {
    if (!state.activeSessionId) return null;
    return state.sessions[state.activeSessionId] ?? null;
  });
  const nodes = execution?.nodes ?? EMPTY_NODES;
  const canvasContainerRef = useRef<HTMLDivElement>(null);
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
    <Dialog
      open={selected !== null}
      modal={false}
      onOpenChange={(open) => {
        if (!open) {
          setSelected(null);
        }
      }}
    >
      <div ref={canvasContainerRef} className="relative w-full h-full bg-white">
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

        {selected && <NodeDetail node={selected} container={canvasContainerRef.current} />}
      </div>
    </Dialog>
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

function NodeDetail({ node, container }: { node: NodeStatus; container: HTMLElement | null }) {
  return (
    <DialogPortal container={container ?? undefined}>
      <DialogPrimitive.Content
        aria-describedby={undefined}
        className="absolute right-4 top-4 z-50 w-80 rounded-xl border border-gray-200 bg-white p-4 shadow-lg focus:outline-none"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <DialogTitle className="text-sm font-semibold text-gray-900">{node.title}</DialogTitle>
          <DialogClose asChild>
            <button className="text-gray-400 transition-colors hover:text-gray-700 text-lg leading-none" type="button">
              ×
            </button>
          </DialogClose>
        </div>

        <div className="space-y-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-gray-500">Status</span>
            <span
              className="rounded-full px-2 py-0.5 text-xs font-medium text-white"
              style={{ background: STATUS_COLORS[node.status] }}
            >
              {node.status}
            </span>
            {node.durationMs && (
              <span className="ml-auto text-gray-400">{(node.durationMs / 1000).toFixed(1)}s</span>
            )}
          </div>

          {node.filesWritten.length > 0 && (
            <div>
              <div className="mb-1 font-medium text-gray-500">Files</div>
              {node.filesWritten.map((f) => (
                <div key={f} className="pl-2 font-mono text-green-700">📄 {f}</div>
              ))}
            </div>
          )}

          {node.verifications.length > 0 && (
            <div>
              <div className="mb-1 font-medium text-gray-500">Verifications</div>
              {node.verifications.map((v, i) => (
                <div key={i} className="flex gap-1 pl-2">
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
              <div className="mb-1 font-medium text-gray-500">Error</div>
              <div className="break-all rounded bg-red-50 p-2 pl-2 font-mono text-red-600">{node.error}</div>
            </div>
          )}
        </div>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}
