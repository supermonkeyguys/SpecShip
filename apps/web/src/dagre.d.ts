declare module "dagre" {
  export interface DagreGraphLabel {
    rankdir?: "TB" | "BT" | "LR" | "RL";
    ranksep?: number;
    nodesep?: number;
    marginx?: number;
    marginy?: number;
  }

  export interface DagreNodeLabel {
    width: number;
    height: number;
    x: number;
    y: number;
  }

  export interface DagreGraph {
    setDefaultEdgeLabel(callback: () => unknown): void;
    setGraph(label: DagreGraphLabel): void;
    setNode(id: string, label: { width: number; height: number }): void;
    setEdge(source: string, target: string): void;
    node(id: string): DagreNodeLabel | undefined;
  }

  export interface Graphlib {
    Graph: new () => DagreGraph;
  }

  const dagre: {
    graphlib: Graphlib;
    layout(graph: DagreGraph): void;
  };

  export default dagre;
}
