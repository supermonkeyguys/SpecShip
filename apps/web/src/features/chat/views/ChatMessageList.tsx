import type { RefObject } from "react";
import { LoadingState } from "../../../shared/ui/LoadingState";
import type { Message } from "../types";
import { ChatMessageItem } from "./ChatMessageItem";

interface Props {
  messages: Message[];
  loading: boolean;
  bottomRef: RefObject<HTMLDivElement | null>;
  onPlanConfirm?: (plan: string) => void;
  onPlanDiscard?: () => void;
}

export function ChatMessageList({
  messages,
  loading,
  bottomRef,
  onPlanConfirm,
  onPlanDiscard,
}: Props) {
  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-2">
      {messages.map((message, index) => (
        <ChatMessageItem
          key={index}
          message={message}
          onPlanConfirm={onPlanConfirm}
          onPlanDiscard={onPlanDiscard}
        />
      ))}
      {loading && (
        <LoadingState
          label="Thinking"
          className="px-3 py-2 rounded-lg bg-gray-100 border border-gray-200"
        />
      )}
      <div ref={bottomRef} />
    </div>
  );
}
