import { Dialog } from "../../components/ui/dialog";
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from "reactflow";
import { NodeDetailPanel } from "./components/NodeDetailPanel";
import type { CanvasFlowNodeData, CanvasNodes, CanvasSessionRef } from "./canvas.types";
import type { NodeStatus } from "../../types";

export function CanvasView({
  rfNodes,
  rfEdges,
  nodes,
  selectedNode,
  session,
  portalContainer,
  onContainerRef,
  onNodeSelect,
  onOpenChange,
  onReactFlowInit,
}: {
  rfNodes: Node<CanvasFlowNodeData>[];
  rfEdges: Edge[];
  nodes: CanvasNodes;
  selectedNode: NodeStatus | null;
  session: CanvasSessionRef | null;
  portalContainer: HTMLDivElement | null;
  onContainerRef: (node: HTMLDivElement | null) => void;
  onNodeSelect: (nodeId: string) => void;
  onOpenChange: (open: boolean) => void;
  onReactFlowInit: (instance: ReactFlowInstance) => void;
}) {
  return (
    <Dialog open={selectedNode !== null} modal={false} onOpenChange={onOpenChange}>
      <div ref={onContainerRef} className="relative h-full w-full bg-white">
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodesDraggable={false}
          nodesConnectable={false}
          onInit={onReactFlowInit}
          onNodeClick={(_, node) => onNodeSelect(node.id)}
          defaultEdgeOptions={{
            style: { stroke: "#6b7280", strokeWidth: 1.5 },
            markerEnd: { type: MarkerType.ArrowClosed, color: "#6b7280", width: 16, height: 16 },
          }}
        >
          <Background color="#000000" gap={20} />
          <Controls />
        </ReactFlow>

        {selectedNode && (
          <NodeDetailPanel
            node={selectedNode}
            nodes={nodes}
            session={session}
            container={portalContainer}
          />
        )}
      </div>
    </Dialog>
  );
}
