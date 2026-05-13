import type { RefObject } from "react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import type { GraphRunStatus } from "../../../domains/execution/types";
import type { Message } from "../types";
import { ChatMessageList } from "./ChatMessageList";
import { FailedSessionBanner, RunningStatusBanner } from "./SessionStatusBanner";

interface Props {
  messages: Message[];
  loading: boolean;
  input: string;
  runStatus: GraphRunStatus;
  retrying: boolean;
  canRetry: boolean;
  bottomRef: RefObject<HTMLDivElement | null>;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onRetrySession: () => void;
  onPlanConfirm?: (plan: string) => void;
  onPlanDiscard?: () => void;
}

export function ChatPanelView({
  messages,
  loading,
  input,
  runStatus,
  retrying,
  canRetry,
  bottomRef,
  onInputChange,
  onSend,
  onRetrySession,
  onPlanConfirm,
  onPlanDiscard,
}: Props) {
  return (
    <section className="flex-1 flex flex-col overflow-hidden" aria-label="Chat messages and composer">
      <ChatMessageList
        messages={messages}
        loading={loading}
        bottomRef={bottomRef}
        onPlanConfirm={onPlanConfirm}
        onPlanDiscard={onPlanDiscard}
      />

      {runStatus === "running" ? <RunningStatusBanner /> : null}
      {runStatus === "failed" ? (
        <FailedSessionBanner disabled={!canRetry || retrying} retrying={retrying} onRetry={onRetrySession} />
      ) : null}

      <div className="border-t border-gray-200 p-3 flex gap-2">
        <Input
          aria-label="Message input"
          value={input}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && onSend()}
          placeholder="Build something, retry a node..."
          disabled={loading}
          className="h-auto flex-1 rounded-lg bg-gray-50 py-2 text-xs font-mono shadow-none"
        />
        <Button
          type="button"
          onClick={onSend}
          disabled={loading}
          className="h-auto rounded-lg px-3 py-2 text-xs font-medium"
        >
          Send
        </Button>
      </div>
    </section>
  );
}
