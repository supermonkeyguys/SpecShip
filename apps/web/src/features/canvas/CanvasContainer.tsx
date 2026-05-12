import { useCallback, useState } from "react";
import type { ReactFlowInstance } from "reactflow";
import { selectExecutionByRef } from "../../domains/execution/selectors";
import { useExecutionStore } from "../../domains/execution/store";
import { useWorkspaceStore } from "../../domains/workspace/store";
import { CanvasView } from "./CanvasView";
import { EMPTY_NODES } from "./canvas.constants";
import { useCanvasGraph } from "./hooks/useCanvasGraph";
import { useCanvasViewport } from "./hooks/useCanvasViewport";

export function CanvasContainer() {
  const activeSession = useWorkspaceStore((state) => state.activeSession);
  const execution = useExecutionStore((state) => selectExecutionByRef(state, activeSession));
  const nodes = execution?.nodes ?? EMPTY_NODES;

  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [reactFlow, setReactFlow] = useState<ReactFlowInstance | null>(null);

  const handleContainerRef = useCallback((node: HTMLDivElement | null) => {
    setPortalContainer(node);
  }, []);

  const selectedNode = selectedNodeId ? nodes[selectedNodeId] ?? null : null;
  const session = execution ? { projectId: execution.projectId, sessionId: execution.sessionId } : null;

  const { layoutSignature, rfNodes, rfEdges } = useCanvasGraph(nodes, execution?.sessionId);

  useCanvasViewport({
    reactFlow,
    layoutSignature,
    nodeCount: rfNodes.length,
  });

  return (
    <CanvasView
      rfNodes={rfNodes}
      rfEdges={rfEdges}
      nodes={nodes}
      selectedNode={selectedNode}
      session={session}
      portalContainer={portalContainer}
      onContainerRef={handleContainerRef}
      onNodeSelect={setSelectedNodeId}
      onOpenChange={(open) => {
        if (!open) {
          setSelectedNodeId(null);
        }
      }}
      onReactFlowInit={setReactFlow}
    />
  );
}
