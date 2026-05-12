import { useEffect, useRef } from "react";
import type { ActiveSession } from "../session/types";
import { TaskCreationView } from "./TaskCreationView";
import { useTaskCreationFlow } from "./useTaskCreationFlow";

interface Props {
  onRunStarted?: (session: ActiveSession) => Promise<void> | void;
}

export function TaskCreationContainer({ onRunStarted }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const flow = useTaskCreationFlow({ onRunStarted });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [flow.messages, flow.loading, flow.pendingClarification]);

  return (
    <TaskCreationView
      input={flow.input}
      loading={flow.loading}
      messages={flow.messages}
      pendingClarification={flow.pendingClarification}
      stageLabel={flow.stageLabel}
      composerDisabled={flow.composerDisabled}
      composerHint={flow.composerHint}
      bottomRef={bottomRef}
      onInputChange={flow.setInput}
      onSend={flow.send}
      onSuggestionClick={flow.setInput}
      onClarificationConfirm={flow.confirmClarification}
      onClarificationSkip={flow.skipClarification}
      onPRDConfirm={flow.confirmPRD}
      onPRDDiscard={flow.discardPRD}
    />
  );
}
