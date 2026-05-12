import { useEffect, useMemo, useRef } from "react";
import type { SessionRef } from "../../session/types";
import { useExecutionForSession } from "../hooks/useExecutionForSession";
import { EMPTY_LOGS, EMPTY_NODES } from "../types";
import { LogPanelView } from "../views/LogPanelView";

interface Props {
  sessionRef?: SessionRef;
}

export function LogPanelContainer({ sessionRef }: Props) {
  const execution = useExecutionForSession(sessionRef);
  const logs = execution?.logs ?? EMPTY_LOGS;
  const nodes = execution?.nodes ?? EMPTY_NODES;
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs, nodes]);

  const nodeList = useMemo(() => Object.values(nodes), [nodes]);

  return <LogPanelView nodeList={nodeList} logs={logs} bottomRef={bottomRef} />;
}
