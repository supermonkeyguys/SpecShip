import dagre from "dagre";
import type { Edge, Node } from "reactflow";

export interface CanvasLayoutOptions {
  direction?: "LR" | "TB";
  nodeWidth?: number;
  nodeHeight?: number;
  rankSep?: number;
  nodeSep?: number;
}

export const DEFAULT_NODE_WIDTH = 220;
export const DEFAULT_NODE_HEIGHT = 112;

const DEFAULT_GRID_X_GAP = 40;
const DEFAULT_GRID_Y_GAP = 60;

const DEFAULT_LAYOUT_OPTIONS: Required<CanvasLayoutOptions> = {
  direction: "LR",
  nodeWidth: DEFAULT_NODE_WIDTH,
  nodeHeight: DEFAULT_NODE_HEIGHT,
  rankSep: 128,
  nodeSep: 56,
};

function resolveDimension(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function getNodeWidth<T>(node: Node<T>, fallback: number): number {
  return resolveDimension(node.style?.width, fallback);
}

function getNodeHeight<T>(node: Node<T>, fallback: number): number {
  return resolveDimension(node.style?.height, resolveDimension(node.style?.minHeight, fallback));
}

function buildGridLayout<T>(nodes: Node<T>[], options: Required<CanvasLayoutOptions>): Node<T>[] {
  const cols = Math.ceil(Math.sqrt(nodes.length)) || 1;
  const xGap = options.nodeWidth + DEFAULT_GRID_X_GAP;
  const yGap = options.nodeHeight + DEFAULT_GRID_Y_GAP;

  return nodes.map((node, index) => ({
    ...node,
    position: {
      x: (index % cols) * xGap,
      y: Math.floor(index / cols) * yGap,
    },
  }));
}

export function applyAutoLayout<T>(
  nodes: Node<T>[],
  edges: Edge[],
  options: CanvasLayoutOptions = {}
): Node<T>[] {
  if (nodes.length === 0) return nodes;

  const resolved = { ...DEFAULT_LAYOUT_OPTIONS, ...options };

  try {
    const graph = new dagre.graphlib.Graph();
    graph.setDefaultEdgeLabel(() => ({}));
    graph.setGraph({
      rankdir: resolved.direction,
      ranksep: resolved.rankSep,
      nodesep: resolved.nodeSep,
      marginx: 24,
      marginy: 24,
    });

    for (const node of nodes) {
      graph.setNode(node.id, {
        width: getNodeWidth(node, resolved.nodeWidth),
        height: getNodeHeight(node, resolved.nodeHeight),
      });
    }

    for (const edge of edges) {
      graph.setEdge(edge.source, edge.target);
    }

    dagre.layout(graph);

    return nodes.map((node) => {
      const positioned = graph.node(node.id);
      if (!positioned) {
        throw new Error(`Missing dagre position for node ${node.id}`);
      }

      const width = getNodeWidth(node, resolved.nodeWidth);
      const height = getNodeHeight(node, resolved.nodeHeight);

      return {
        ...node,
        position: {
          x: positioned.x - width / 2,
          y: positioned.y - height / 2,
        },
      };
    });
  } catch {
    return buildGridLayout(nodes, resolved);
  }
}
