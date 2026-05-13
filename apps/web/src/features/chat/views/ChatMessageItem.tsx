import type { Message } from "../types";
import { ClarificationSummaryCard } from "./ClarificationSummaryCard";
import { PlanEditorCard } from "../../task-creation/PlanEditorCard";

interface Props {
  message: Message;
  onPlanConfirm?: (plan: string) => void;
  onPlanDiscard?: () => void;
}

export function ChatMessageItem({ message, onPlanConfirm, onPlanDiscard }: Props) {
  if (message.role === "clarification") {
    return <ClarificationSummaryCard message={message} />;
  }

  if (message.role === "plan") {
    if (message.confirmed) {
      return (
        <div className="rounded-2xl border border-green-300 bg-green-50 overflow-hidden text-xs">
          <div className="px-4 py-2.5 flex items-center gap-2 font-semibold text-green-700 bg-green-100">
            <span>✅</span>
            <span>执行计划已确认，开始执行。</span>
          </div>
        </div>
      );
    }

    return (
      <PlanEditorCard
        plan={message.plan}
        onConfirm={onPlanConfirm ?? (() => {})}
        onDiscard={onPlanDiscard ?? (() => {})}
      />
    );
  }

  return (
    <div
      className={`text-xs px-3 py-2 rounded-lg font-mono ${
        message.role === "user"
          ? "bg-blue-600 text-white ml-4"
          : message.role === "ai"
            ? "bg-gray-100 text-gray-800 border border-gray-200"
            : "text-gray-400 text-center"
      }`}
    >
      {message.role === "user" ? "> " : ""}
      {message.text}
    </div>
  );
}
