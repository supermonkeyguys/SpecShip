import type { KeyboardEvent, RefObject } from "react";
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/textarea";
import { ClarificationCard } from "../chat/ClarificationCard";
import { ChatMessageList } from "../chat/views/ChatMessageList";
import type { Message } from "../chat/types";
import type { PendingClarification } from "./taskCreation.types";

const SUGGESTIONS = [
  "Build a landing page for a SaaS product with pricing and FAQ sections.",
  "Create a React dashboard with a sidebar, charts, and a recent activity feed.",
  "Implement a Node.js API for task management with CRUD endpoints and tests.",
];

interface Props {
  input: string;
  loading: boolean;
  messages: Message[];
  pendingClarification: PendingClarification | null;
  stageLabel: string;
  composerDisabled: boolean;
  composerHint: string;
  bottomRef: RefObject<HTMLDivElement | null>;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onSuggestionClick: (suggestion: string) => void;
  onClarificationConfirm: (answers: Record<string, string>) => void;
  onClarificationSkip: () => void;
  onPRDConfirm: (prd: string) => void;
  onPRDDiscard: () => void;
}

export function TaskCreationView({
  input,
  loading,
  messages,
  pendingClarification,
  stageLabel,
  composerDisabled,
  composerHint,
  bottomRef,
  onInputChange,
  onSend,
  onSuggestionClick,
  onClarificationConfirm,
  onClarificationSkip,
  onPRDConfirm,
  onPRDDiscard,
}: Props) {
  const showSuggestions = messages.length <= 1 && !pendingClarification;

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      onSend();
    }
  };

  return (
    <section className="flex h-full min-h-0 overflow-hidden bg-gradient-to-b from-white via-blue-50/40 to-white">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col px-6 py-8">
        <div className="flex-shrink-0 space-y-4 px-2 pb-6 pt-4 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-700">
            <span>✨</span>
            <span>New task</span>
          </div>

          <div className="space-y-3">
            <h1 className="text-3xl font-semibold tracking-tight text-gray-900">
              Describe what you want to build
            </h1>
            <p className="mx-auto max-w-2xl text-sm leading-6 text-gray-500">
              Start from a rough idea, refine the scope, review the PRD draft, and only then enter the execution canvas.
            </p>
          </div>

          {showSuggestions ? (
            <div className="flex flex-wrap items-center justify-center gap-2 text-left">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => onSuggestionClick(suggestion)}
                  className="max-w-[18rem] rounded-2xl border border-gray-200 bg-white/90 px-3 py-2 text-left text-xs leading-5 text-gray-500 shadow-sm transition hover:border-blue-300 hover:bg-white hover:text-gray-700"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-hidden rounded-[28px] border border-gray-200 bg-white shadow-[0_10px_40px_rgba(15,23,42,0.08)]">
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center justify-between gap-3 border-b border-gray-100 bg-gray-50 px-5 py-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Task creation</div>
                <div className="text-sm font-medium text-gray-800">{stageLabel}</div>
              </div>
              <div className="rounded-full border border-gray-200 bg-white px-3 py-1 text-[11px] text-gray-500">
                PRD before canvas
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-hidden">
              <ChatMessageList
                messages={messages}
                loading={loading}
                bottomRef={bottomRef}
                onPRDConfirm={onPRDConfirm}
                onPRDDiscard={onPRDDiscard}
              />
            </div>

            {pendingClarification ? (
              <div className="border-t border-gray-100 bg-gray-50 p-4">
                <ClarificationCard
                  questions={pendingClarification.questions}
                  onConfirm={onClarificationConfirm}
                  onSkip={onClarificationSkip}
                />
              </div>
            ) : null}

            <div className="border-t border-gray-200 bg-white p-4">
              <div className="rounded-3xl border border-gray-200 bg-gray-50 p-3 shadow-sm">
                <Textarea
                  aria-label="Task description input"
                  value={input}
                  onChange={(event) => onInputChange(event.target.value)}
                  onKeyDown={handleComposerKeyDown}
                  placeholder="Describe the product, feature, or system you want to build..."
                  disabled={composerDisabled}
                  className="min-h-[120px] resize-none border-0 bg-transparent px-1 py-1 text-sm leading-6 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                />
                <div className="mt-3 flex items-center justify-between gap-3 border-t border-gray-200 pt-3">
                  <div className="text-xs text-gray-400">{composerHint}</div>
                  <Button type="button" onClick={onSend} disabled={composerDisabled || !input.trim()} className="rounded-xl px-4">
                    {loading ? "Working..." : "Draft PRD"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
