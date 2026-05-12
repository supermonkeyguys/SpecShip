import type { ClarificationMessage } from "../../../domains/execution/types";

interface Props {
  message: ClarificationMessage;
}

export function ClarificationSummaryCard({ message }: Props) {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 overflow-hidden text-xs">
      <div className="px-4 py-2.5 flex items-center gap-2 font-semibold text-amber-700 bg-amber-100">
        <span>💬</span>
        <span>{message.answered ? "Clarifications captured" : "Need clarification before continuing"}</span>
      </div>
      <div className="space-y-2 px-4 py-3 text-gray-700">
        {message.questions.map((question, idx) => (
          <div key={question.id} className="space-y-1">
            <div className="font-medium">
              {idx + 1}. {question.text}
            </div>
            {message.answered && message.answers?.[question.id] ? (
              <div className="font-mono text-[11px] text-gray-500">→ {message.answers[question.id]}</div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
