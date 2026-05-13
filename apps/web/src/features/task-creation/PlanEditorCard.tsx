// apps/web/src/features/task-creation/PlanEditorCard.tsx
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/textarea";

interface StepSummary {
  id: string;
  title: string;
  checkpoint: boolean;
}

function parseStepTitles(plan: string): StepSummary[] {
  const steps: StepSummary[] = [];
  const lines = plan.split("\n");
  const headingRe = /^### step:\s*(.+)$/;
  for (let i = 0; i < lines.length; i++) {
    const m = headingRe.exec(lines[i]);
    if (!m) continue;
    const id = m[1].trim();
    let title = id;
    let checkpoint = false;
    for (let j = i + 1; j < lines.length && !lines[j].startsWith("### "); j++) {
      const tMatch = /^- title:\s*(.+)$/.exec(lines[j]);
      if (tMatch) title = tMatch[1].trim();
      const cpMatch = /^- checkpoint:\s*(.+)$/.exec(lines[j]);
      if (cpMatch) checkpoint = cpMatch[1].trim() === "true";
    }
    steps.push({ id, title, checkpoint });
  }
  return steps;
}

function parseGoal(plan: string): string {
  const lines = plan.split("\n");
  const goalIdx = lines.findIndex((l) => l.trim() === "## 目标");
  if (goalIdx === -1) return "";
  const goalLines: string[] = [];
  for (let i = goalIdx + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ") || lines[i].startsWith("---")) break;
    if (lines[i].trim()) goalLines.push(lines[i].trim());
  }
  return goalLines.join(" ");
}

interface Props {
  plan: string;
  onConfirm: (plan: string) => void;
  onDiscard: () => void;
}

export function PlanEditorCard({ plan, onConfirm, onDiscard }: Props) {
  const [value, setValue] = useState(plan);
  const [expertMode, setExpertMode] = useState(false);

  const goal = parseGoal(value);
  const steps = parseStepTitles(value);

  return (
    <div className="rounded-2xl border border-blue-200 overflow-hidden shadow-sm text-xs">
      <div className="bg-blue-50 border-b border-blue-200 px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold text-blue-800">
          <span>📋</span>
          <span>执行计划草稿 — 确认后开始执行</span>
        </div>
        <button
          type="button"
          onClick={() => setExpertMode((v) => !v)}
          className="text-[11px] text-blue-600 hover:underline"
        >
          {expertMode ? "简单视图" : "专家模式"}
        </button>
      </div>

      {expertMode ? (
        <div className="bg-white px-4 py-3">
          <p className="mb-2 text-[11px] text-gray-500">
            可直接编辑 Markdown。修改 <code>depends</code> 调整执行顺序，将 <code>checkpoint: false</code> 改为 <code>true</code> 可插入人工确认点。
          </p>
          <Textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="min-h-[400px] w-full resize-y rounded-lg bg-gray-50 p-3 text-xs font-mono shadow-none border-gray-200 leading-relaxed"
            spellCheck={false}
          />
        </div>
      ) : (
        <div className="bg-white px-4 py-3 space-y-3">
          {goal && (
            <div>
              <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">目标</div>
              <p className="text-xs text-gray-700 leading-relaxed">{goal}</p>
            </div>
          )}
          <div>
            <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">
              执行步骤 ({steps.length})
            </div>
            <ol className="space-y-1">
              {steps.map((step, idx) => (
                <li key={step.id} className="flex items-start gap-2 text-xs text-gray-700">
                  <span className="text-gray-400 w-4 flex-shrink-0">{idx + 1}.</span>
                  <span>{step.title}</span>
                  {step.checkpoint && (
                    <span className="ml-1 rounded bg-yellow-100 px-1 text-[10px] text-yellow-700">⏸ checkpoint</span>
                  )}
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}

      <div className="bg-blue-50 border-t border-blue-200 px-4 py-2.5 flex justify-end items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={onDiscard}
          className="h-auto rounded-lg px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-200 hover:text-gray-600"
        >
          放弃
        </Button>
        <Button
          type="button"
          onClick={() => onConfirm(value.trim())}
          disabled={!value.trim()}
          className="h-auto rounded-lg px-4 py-1.5 text-xs font-semibold"
        >
          确认并执行
        </Button>
      </div>
    </div>
  );
}
