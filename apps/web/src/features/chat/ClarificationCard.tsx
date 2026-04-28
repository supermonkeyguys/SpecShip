/**
 * ClarificationCard.tsx — 澄清问题交互卡片
 *
 * 渲染一组结构化问题（选项卡 + 自由输入），用户全部填写后才能确认。
 * 由 Chat.tsx 在 role="clarification" 消息时渲染。
 */

import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Separator } from "../../components/ui/separator";
import { Textarea } from "../../components/ui/textarea";
import type { ClarifyQuestion } from "../../types";

interface Props {
  questions: ClarifyQuestion[];
  onConfirm: (answers: Record<string, string>) => void;
  onSkip: () => void;
}

export function ClarificationCard({ questions, onConfirm, onSkip }: Props) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [otherText, setOtherText] = useState<Record<string, string>>({});

  const setAnswer = (qid: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [qid]: value }));
  };

  const isReady = questions.every((q) => {
    const ans = answers[q.id];
    if (!ans) return false;
    if (ans === "__other__") return (otherText[q.id] ?? "").trim().length > 0;
    return true;
  });

  const handleConfirm = () => {
    if (!isReady) return;
    const resolved: Record<string, string> = {};
    for (const q of questions) {
      if (answers[q.id] === "__other__") {
        resolved[q.id] = otherText[q.id] ?? "";
      } else {
        resolved[q.id] = q.options?.find((o) => o.id === answers[q.id])?.label ?? answers[q.id] ?? "";
      }
    }
    onConfirm(resolved);
  };

  return (
    <div className="rounded-2xl border border-gray-200 overflow-hidden shadow-sm text-xs">
      {/* Header */}
      <div className="bg-gray-50 border-b border-gray-200 px-4 py-2.5 flex items-center gap-2 font-semibold text-gray-800">
        <span>💬</span>
        <span>开始之前，我需要确认几个问题</span>
      </div>

      {/* Questions */}
      <div className="bg-white px-4 py-3 flex flex-col gap-4">
        {questions.map((q, idx) => (
          <div key={q.id} className="flex flex-col gap-2">
            {idx > 0 && <Separator className="-mx-4 w-auto bg-gray-100" />}
            <div className="font-semibold text-gray-800 pt-1">
              {idx + 1}. {q.text}
            </div>

            {q.mode === "options" ? (
              <>
                <div className="grid grid-cols-2 gap-1.5">
                  {(q.options ?? []).map((opt) => {
                    const selected = answers[q.id] === opt.id;
                    return (
                      <Button
                        key={opt.id}
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setAnswer(q.id, opt.id);
                        }}
                        className={`h-auto flex-col items-start justify-start gap-0.5 rounded-xl px-3 py-2 text-left text-xs whitespace-normal shadow-none ${
                          selected
                            ? "border-blue-500 bg-blue-50 hover:bg-blue-50"
                            : "bg-gray-50 hover:bg-gray-100"
                        }`}
                      >
                        <span className={`font-semibold ${selected ? "text-blue-600" : "text-gray-800"}`}>
                          {opt.label}
                        </span>
                        <span className={`text-[10.5px] leading-tight ${selected ? "text-blue-400" : "text-gray-400"}`}>
                          {opt.description}
                        </span>
                      </Button>
                    );
                  })}
                  {/* Fixed "other" option — always present for options-mode questions */}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setAnswer(q.id, "__other__");
                    }}
                    className={`h-auto flex-col items-start justify-start gap-0.5 rounded-xl px-3 py-2 text-left text-xs whitespace-normal shadow-none ${
                      answers[q.id] === "__other__"
                        ? "border-blue-500 bg-blue-50 hover:bg-blue-50"
                        : "bg-gray-50 hover:bg-gray-100"
                    }`}
                  >
                    <span className={`font-semibold ${answers[q.id] === "__other__" ? "text-blue-600" : "text-gray-800"}`}>
                      其他...
                    </span>
                    <span className="text-[10.5px] text-gray-400">自由描述</span>
                  </Button>
                </div>
                {answers[q.id] === "__other__" && (
                  <Textarea
                    className="h-14 min-h-[3.5rem] resize-none border-blue-400 bg-blue-50 text-xs font-mono shadow-none"
                    placeholder="描述你的需求..."
                    value={otherText[q.id] ?? ""}
                    onChange={(e) => setOtherText((t) => ({ ...t, [q.id]: e.target.value }))}
                  />
                )}
              </>
            ) : (
              <Input
                type="text"
                className="h-auto rounded-lg bg-gray-50 py-2 text-xs font-mono shadow-none"
                placeholder="请输入..."
                value={answers[q.id] ?? ""}
                onChange={(e) => setAnswer(q.id, e.target.value)}
              />
            )}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="bg-gray-50 border-t border-gray-200 px-4 py-2.5 flex justify-end items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={onSkip}
          className="h-auto rounded-lg px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-200 hover:text-gray-600"
        >
          跳过，直接开始
        </Button>
        <Button
          type="button"
          onClick={handleConfirm}
          disabled={!isReady}
          className={`h-auto rounded-lg px-4 py-1.5 text-xs font-semibold ${
            isReady ? "" : "bg-blue-200 hover:bg-blue-200"
          }`}
        >
          确认
        </Button>
      </div>
    </div>
  );
}
