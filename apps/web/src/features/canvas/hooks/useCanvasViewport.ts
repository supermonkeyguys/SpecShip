import { useEffect } from "react";
import type { ReactFlowInstance } from "reactflow";

export function useCanvasViewport({
  reactFlow,
  layoutSignature,
  nodeCount,
}: {
  reactFlow: ReactFlowInstance | null;
  layoutSignature: string;
  nodeCount: number;
}) {
  useEffect(() => {
    if (!reactFlow || nodeCount === 0) return;

    const frame = requestAnimationFrame(() => {
      reactFlow.fitView({
        padding: 0.16,
        duration: 250,
        includeHiddenNodes: false,
      });
    });

    return () => cancelAnimationFrame(frame);
  }, [layoutSignature, nodeCount, reactFlow]);
}
