import { useMemo } from "react";
import { type Edge, MarkerType, type Node, Position } from "reactflow";
import { STATUS_BG, STATUS_COLORS, estimateNodeHeight } from "../canvas.constants";
import type { CanvasFlowNodeData, CanvasNodes } from "../canvas.types";
import { NodeCard } from "../components/NodeCard";
import { applyAutoLayout, DEFAULT_NODE_HEIGHT, DEFAULT_NODE_WIDTH } from "../layout";

export function useCanvasGraph(nodes: CanvasNodes, sessionId?: string) {
  const nodeList = useMemo(() => Object.values(nodes), [nodes]);

  const layoutSignature = useMemo(
    () => `${sessionId ?? ""}::${nodeList.map((node) => `${node.id}:${node.dependsOn.join(",")}`).join("|")}`,
    [sessionId, nodeList]
  );

  const { rfNodes, rfEdges } = useMemo(() => {
    const baseNodes: Node<CanvasFlowNodeData>[] = nodeList.map((node) => {
      const estimatedHeight = estimateNodeHeight(node);

      return {
        id: node.id,
        position: { x: 0, y: 0 },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        data: { label: <NodeCard node={node} /> },
        style: {
          border: `1.5px solid ${STATUS_COLORS[node.status]}`,
          borderRadius: 8,
          background: STATUS_BG[node.status],
          padding: 0,
          width: DEFAULT_NODE_WIDTH,
          minHeight: estimatedHeight,
          boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
        },
      };
    });

    const rfEdges: Edge[] = nodeList.flatMap((node) =>
      node.dependsOn.map((dependencyId) => ({
        id: `${dependencyId}->${node.id}`,
        source: dependencyId,
        target: node.id,
        animated: node.status === "running",
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

  return { nodeList, layoutSignature, rfNodes, rfEdges };
}
