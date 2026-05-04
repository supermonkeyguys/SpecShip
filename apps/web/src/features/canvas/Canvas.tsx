/**
 * Canvas.tsx — 中间画板（React Flow DAG）
 */

import { useEffect, useMemo, useState, useCallback } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import ReactFlow, {
  type Node,
  type Edge,
  Background,
  Controls,
  MarkerType,
  Position,
  type ReactFlowInstance,
} from "reactflow";
import "reactflow/dist/style.css";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogPortal,
  DialogTitle,
} from "../../components/ui/dialog";
import { useExecutionStore } from "../../domains/execution/store";
import type { SessionExecutionState } from "../../domains/execution/types";
import type { NodeStatus } from "../../types";
import { retryNode, editNode } from "../../shared/api/nodeClient";
import type { NodeEditImpact } from "../../types";
import { applyAutoLayout, DEFAULT_NODE_HEIGHT, DEFAULT_NODE_WIDTH } from "./layout";
import { ImpactPanel } from "./ImpactPanel";

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

function estimateNodeHeight(node: NodeStatus): number {
  if (node.status === "failed" && node.error) {
    return DEFAULT_NODE_HEIGHT + 36;
  }
  return DEFAULT_NODE_HEIGHT;
}

export function Canvas() {
  const execution = useExecutionStore((state) => {
    if (!state.activeSessionId) return null;
    return state.sessions[state.activeSessionId] ?? null;
  });
  const nodes = execution?.nodes ?? EMPTY_NODES;
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [reactFlow, setReactFlow] = useState<ReactFlowInstance | null>(null);
  const handleContainerRef = useCallback((node: HTMLDivElement | null) => {
    setPortalContainer(node);
  }, []);
  const selected = selectedNodeId ? (nodes[selectedNodeId] ?? null) : null;
  const nodeList = useMemo(() => Object.values(nodes), [nodes]);
  const layoutSignature = useMemo(
    () => `${execution?.sessionId ?? ""}::${nodeList.map((node) => `${node.id}:${node.dependsOn.join(",")}`).join("|")}`,
    [execution?.sessionId, nodeList]
  );

  const { rfNodes, rfEdges } = useMemo(() => {

    const baseNodes: Node[] = nodeList.map((n) => {
      const estimatedHeight = estimateNodeHeight(n);

      return {
        id: n.id,
        position: { x: 0, y: 0 },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        data: { label: <NodeCard node={n} /> },
        style: {
          border: `1.5px solid ${STATUS_COLORS[n.status]}`,
          borderRadius: 8,
          background: STATUS_BG[n.status],
          padding: 0,
          width: DEFAULT_NODE_WIDTH,
          minHeight: estimatedHeight,
          boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
        },
      };
    });

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

    const rfNodes = applyAutoLayout(baseNodes, rfEdges, {
      direction: "LR",
      nodeWidth: DEFAULT_NODE_WIDTH,
      nodeHeight: DEFAULT_NODE_HEIGHT,
    });

    return { rfNodes, rfEdges };
  }, [nodeList]);

  useEffect(() => {
    if (!reactFlow || rfNodes.length === 0) return;

    const frame = requestAnimationFrame(() => {
      reactFlow.fitView({
        padding: 0.16,
        duration: 250,
        includeHiddenNodes: false,
      });
    });

    return () => cancelAnimationFrame(frame);
  }, [layoutSignature, reactFlow, rfNodes.length]);

  return (
    <Dialog
      open={selected !== null}
      modal={false}
      onOpenChange={(open) => {
        if (!open) {
          setSelectedNodeId(null);
        }
      }}
    >
      <div ref={handleContainerRef} className="relative w-full h-full bg-white">
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodesDraggable={false}
          nodesConnectable={false}
          onInit={setReactFlow}
          onNodeClick={(_, node) => setSelectedNodeId(node.id)}
          defaultEdgeOptions={{
            style: { stroke: "#6b7280", strokeWidth: 1.5 },
            markerEnd: { type: MarkerType.ArrowClosed, color: "#6b7280", width: 16, height: 16 },
          }}
        >
          <Background color="#000000" gap={20} />
          <Controls />
        </ReactFlow>

        {selected && (
          <NodeDetail
            node={selected}
            nodes={nodes}
            session={execution ? { projectId: execution.projectId, sessionId: execution.sessionId } : null}
            container={portalContainer}
          />
        )}
      </div>
    </Dialog>
  );
}

const NODE_TYPE_LABEL: Record<NodeStatus["nodeType"], string> = {
  implement:  "impl",
  checkpoint: "checkpoint",
};

const STATUS_LABEL: Record<NodeStatus["status"], string> = {
  pending:   "pending",
  ready:     "ready",
  running:   "running",
  verifying: "verifying",
  done:      "done",
  failed:    "failed",
  blocked:   "blocked",
  skipped:   "skipped",
};

const ERROR_CATEGORY_LABEL: Record<string, string> = {
  compile:  "Compile error",
  api:      "API error",
  logic:    "Logic error",
  timeout:  "Timeout",
  unknown:  "Error",
};

function NodeCard({ node }: { node: NodeStatus }) {
  const color = STATUS_COLORS[node.status];
  const isRunning = node.status === "running" || node.status === "verifying";
  const isFailed = node.status === "failed";

  return (
    <div className="p-3">
      {/* 标题行：状态点 + 标题 */}
      <div className="flex items-center gap-2 mb-1">
        <span className="relative flex-shrink-0 w-2 h-2">
          {isRunning && (
            <span
              className="absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping"
              style={{ background: color }}
            />
          )}
          <span className="relative inline-flex rounded-full w-2 h-2" style={{ background: color }} />
        </span>
        <span className="text-gray-800 text-xs font-semibold truncate flex-1">{node.title}</span>
        {/* 节点类型小标签 */}
        <span className="flex-shrink-0 text-gray-400 text-xs font-mono bg-gray-100 rounded px-1">
          {NODE_TYPE_LABEL[node.nodeType] ?? node.nodeType}
        </span>
      </div>

      {/* 状态文字 + 耗时 */}
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-medium" style={{ color }}>
          {STATUS_LABEL[node.status]}
        </span>
        {node.durationMs && (
          <span className="text-gray-400 text-xs">{(node.durationMs / 1000).toFixed(1)}s</span>
        )}
        {node.retryCount > 0 && (
          <span className="text-amber-600 text-xs ml-auto">↺ {node.retryCount}/{node.maxRetries}</span>
        )}
      </div>

      {/* specFragment 摘要 */}
      <div className="text-gray-400 text-xs truncate">{node.specFragment.slice(0, 60)}</div>

      {/* 失败时显示错误类型摘要 */}
      {isFailed && node.error && (
        <div className="mt-1.5 rounded bg-red-50 px-1.5 py-1 text-xs text-red-600 truncate">
          {node.errorCategory ? ERROR_CATEGORY_LABEL[node.errorCategory] : "Error"}: {node.error.slice(0, 60)}
        </div>
      )}
    </div>
  );
}

const TOOL_ICONS: Record<string, string> = {
  write_file: "✍️",
  read_file: "📖",
  run_command: "⚡",
  search_files: "🔍",
  list_dir: "📂",
};

function NodeDetail({
  node,
  nodes,
  session,
  container,
}: {
  node: NodeStatus;
  nodes: SessionExecutionState["nodes"];
  session: { projectId: string; sessionId: string } | null;
  container: HTMLElement | null;
}) {
  const descriptionId = `node-detail-description-${node.id}`;
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  // edit state
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(node.title);
  const [applying, setApplying] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [impact, setImpact] = useState<NodeEditImpact | null>(null);

  const handleRetry = useCallback(async () => {
    if (!session) return;
    setRetrying(true);
    setRetryError(null);
    try {
      const r = await retryNode(node.id, session);
      if (!r.ok) setRetryError(r.error ?? "Retry failed");
    } catch (e) {
      setRetryError((e as Error).message);
    } finally {
      setRetrying(false);
    }
  }, [node.id, session]);

  const handleEditApply = useCallback(async () => {
    if (!session || !editTitle.trim()) return;
    setApplying(true);
    setEditError(null);
    setImpact(null);
    try {
      const r = await editNode(node.id, {
        projectId: session.projectId,
        sessionId: session.sessionId,
        updates: { title: editTitle.trim() },
      });
      if (r.ok && r.impact) {
        setImpact(r.impact);
        setEditing(false);
      } else {
        setEditError(r.error ?? "Edit failed");
      }
    } catch (e) {
      setEditError((e as Error).message);
    } finally {
      setApplying(false);
    }
  }, [node.id, session, editTitle]);

  const isActive = node.status === "running" || node.status === "verifying";
  const showToolCalls = (isActive || node.status === "done" || node.status === "failed") &&
    (node.toolCalls?.length ?? 0) > 0;

  return (
    <DialogPortal container={container ?? undefined}>
      <DialogPrimitive.Content
        aria-describedby={descriptionId}
        className="absolute right-4 top-4 z-50 w-80 rounded-xl border border-gray-200 bg-white p-4 shadow-lg focus:outline-none overflow-y-auto max-h-[calc(100%-2rem)]"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <DialogTitle className="text-sm font-semibold text-gray-900">{node.title}</DialogTitle>
          <DialogClose asChild>
            <button
              className="text-gray-400 transition-colors hover:text-gray-700 text-lg leading-none flex-shrink-0"
              type="button"
              aria-label="Close node details"
            >
              ×
            </button>
          </DialogClose>
        </div>

        <DialogDescription id={descriptionId} className="sr-only">
          Node details including status, files, verifications, and errors.
        </DialogDescription>

        <div className="space-y-3 text-xs">
          {/* Status row */}
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

          {/* Blocked: waiting on */}
          {node.status === "blocked" && node.dependsOn.length > 0 && (
            <div className="rounded-md bg-gray-50 px-3 py-2 text-gray-500">
              <span className="font-medium text-gray-400">Waiting for:</span>
              <ul className="mt-1 space-y-0.5 pl-1">
                {node.dependsOn.map((depId) => {
                  const dep = nodes[depId];
                  return (
                    <li key={depId} className="flex items-center gap-1.5">
                      <span
                        className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
                        style={{ background: dep ? STATUS_COLORS[dep.status] : "#9ca3af" }}
                      />
                      <span className="truncate">{dep?.title ?? depId}</span>
                      <span className="ml-auto text-gray-300 flex-shrink-0">{dep?.status}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Tool calls: progress during running, full list when done */}
          {showToolCalls && (
            <div>
              <div className="mb-1 font-medium text-gray-500 flex items-center gap-1">
                {isActive && (
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
                )}
                {isActive ? "In progress" : "Steps"}
              </div>
              <div className="space-y-1">
                {node.toolCalls!.map((tc, i) => {
                  const icon = TOOL_ICONS[tc.tool] ?? "🔧";
                  const inputSummary = tc.tool === "write_file"
                    ? (tc.input.path as string ?? "")
                    : tc.tool === "run_command"
                    ? (tc.input.command as string ?? "").slice(0, 40)
                    : tc.tool === "read_file" || tc.tool === "search_files"
                    ? (tc.input.path as string ?? tc.input.query as string ?? "")
                    : JSON.stringify(tc.input).slice(0, 40);
                  return (
                    <div key={i} className={`flex items-start gap-1.5 pl-1 ${tc.success ? "" : "opacity-60"}`}>
                      <span className="flex-shrink-0 mt-0.5">{icon}</span>
                      <div className="min-w-0">
                        <span className="text-gray-700 font-medium">{tc.tool}</span>
                        {inputSummary && (
                          <span className="ml-1 font-mono text-gray-400 truncate block">{inputSummary}</span>
                        )}
                      </div>
                      {!tc.success && <span className="ml-auto flex-shrink-0 text-red-400">✗</span>}
                    </div>
                  );
                })}
                {isActive && (
                  <div className="flex items-center gap-1.5 pl-1 text-gray-400 animate-pulse">
                    <span>⋯</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Files written */}
          {node.filesWritten.length > 0 && (
            <div>
              <div className="mb-1 font-medium text-gray-500">Files</div>
              {node.filesWritten.map((f) => {
                const name = f.split("/").pop() ?? f;
                const dir = f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : "";
                return (
                  <div key={f} className="flex items-center gap-1 pl-2 min-w-0" title={f}>
                    <span className="flex-shrink-0">📄</span>
                    <span className="font-mono text-green-700 truncate">{name}</span>
                    {dir && (
                      <span className="font-mono text-gray-400 truncate">{dir.split("/").slice(-2).join("/")}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Verifications */}
          {node.verifications.length > 0 && (
            <div>
              <div className="mb-1 font-medium text-gray-500">Verifications</div>
              {node.verifications.map((v, i) => (
                <div key={i} className="flex gap-1 pl-2 min-w-0">
                  <span className={`flex-shrink-0 ${v.passed ? "text-green-600" : "text-red-500"}`}>
                    {v.passed ? "✓" : "✗"}
                  </span>
                  <div className="min-w-0">
                    <span className="text-gray-400">[{v.type}]</span>{" "}
                    <span className="text-gray-600 break-words">{v.summary}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Error */}
          {node.error && (
            <div>
              <div className="mb-1 font-medium text-gray-500">Error</div>
              <div className="break-all rounded bg-red-50 p-2 font-mono text-red-600">{node.error}</div>
            </div>
          )}

          {/* Retry */}
          {node.status === "ready" && (
            <div className="pt-1 text-xs text-blue-500">已加入队列，等待执行…</div>
          )}
          {(node.status === "failed" || node.status === "running") && session && (
            <div className="pt-1">
              <button
                type="button"
                disabled={retrying}
                onClick={handleRetry}
                className="w-full rounded-md px-3 py-1.5 text-xs font-medium transition-colors
                  bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {retrying ? "Retrying…" : node.status === "running" ? "Force Retry" : "Retry"}
              </button>
              {retryError && (
                <div className="mt-1 text-red-500 text-xs">{retryError}</div>
              )}
            </div>
          )}

          {/* Edit node section */}
          {session && (
            <div className="pt-1 border-t border-gray-100">
              {!editing && !impact && (
                <button
                  type="button"
                  onClick={() => { setEditing(true); setEditTitle(node.title); setEditError(null); }}
                  className="w-full rounded-md px-3 py-1.5 text-xs font-medium transition-colors
                    bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
                >
                  Edit Node
                </button>
              )}

              {editing && (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.currentTarget.value)}
                    className="w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-xs text-gray-800 focus:outline-none focus:border-blue-400"
                    placeholder="Node title"
                    onKeyDown={(e) => { if (e.key === "Enter") handleEditApply(); if (e.key === "Escape") setEditing(false); }}
                  />
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      disabled={applying || !editTitle.trim()}
                      onClick={handleEditApply}
                      className="flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors
                        bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {applying ? "Applying…" : "Apply"}
                    </button>
                    <button
                      type="button"
                      disabled={applying}
                      onClick={() => setEditing(false)}
                      className="rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-gray-100"
                    >
                      Cancel
                    </button>
                  </div>
                  {editError && (
                    <div className="text-red-500 text-xs">{editError}</div>
                  )}
                </div>
              )}

              {impact && (
                <div className="pt-1">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-gray-500">Impact Analysis</span>
                    <button
                      type="button"
                      onClick={() => setImpact(null)}
                      className="text-xs text-gray-400 hover:text-gray-600"
                    >
                      Clear
                    </button>
                  </div>
                  <ImpactPanel impact={impact} />
                </div>
              )}
            </div>
          )}
        </div>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}
