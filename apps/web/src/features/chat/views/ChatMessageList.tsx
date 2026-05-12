import type { RefObject } from "react";
import { LoadingState } from "../../../shared/ui/LoadingState";
import type { Message } from "../types";
import { ChatMessageItem } from "./ChatMessageItem";

interface Props {
  messages: Message[];
  loading: boolean;
  bottomRef: RefObject<HTMLDivElement | null>;
  onPRDConfirm: (prd: string) => void;
  onPRDDiscard: () => void;
}

export function ChatMessageList({
  messages,
  loading,
  bottomRef,
  onPRDConfirm,
  onPRDDiscard,
}: Props) {
  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-2">
      {messages.map((message, index) => (
        <ChatMessageItem
          key={index}
          message={message}
          onPRDConfirm={onPRDConfirm}
          onPRDDiscard={onPRDDiscard}
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
