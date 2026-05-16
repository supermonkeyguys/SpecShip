// apps/web/src/features/task-creation/PlanEditorCard.tsx
import { useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/textarea";

interface StepSummary {
  id: string;
  title: string;
  checkpoint: boolean;
  role?: string;
  dependsOn?: string;
}

interface PlanSummary {
  title: string;
  spec: string;
  steps: StepSummary[];
}

function parseLegacyStepTitles(plan: string): StepSummary[] {
  const steps: StepSummary[] = [];
  const lines = plan.split("\n");
  const headingRe = /^### step:\s*(.+)$/i;
  for (let i = 0; i < lines.length; i++) {
    const m = headingRe.exec(lines[i]);
    if (!m) continue;
    const id = m[1].trim();
    let title = id;
    let checkpoint = false;
    for (let j = i + 1; j < lines.length && !lines[j].startsWith("### "); j++) {
      const tMatch = /^- title:\s*(.+)$/i.exec(lines[j]);
      if (tMatch) title = tMatch[1].trim();
      const cpMatch = /^- checkpoint:\s*(.+)$/i.exec(lines[j]);
      if (cpMatch) checkpoint = cpMatch[1].trim() === "true";
    }
    steps.push({ id, title, checkpoint });
  }
  return steps;
}

function parseLegacyGoal(plan: string): string {
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

function parseGoPlan(plan: string): PlanSummary | null {
  const lines = plan.split("\n");
  const titleLine = lines.find((line) => /^##\s+/.test(line.trim()));
  const title = titleLine ? titleLine.replace(/^##\s+/, "").trim() : "";

  const specIndex = lines.findIndex((line) => line.trim() === "### Spec");
  const stepsIndex = lines.findIndex((line) => line.trim() === "### Steps");

  const specLines: string[] = [];
  if (specIndex !== -1) {
    for (let i = specIndex + 1; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed === "### Steps") break;
      if (trimmed) specLines.push(trimmed);
    }
  }

  const steps: StepSummary[] = [];
  if (stepsIndex !== -1) {
    const stepHeadingRe = /^\d+\.\s+\*\*(.+?)\*\*\s+\(`([^`]+)`\s*\/\s*([^\)]+)\)/;
    for (let i = stepsIndex + 1; i < lines.length; i++) {
      const heading = stepHeadingRe.exec(lines[i].trim());
      if (!heading) continue;
      const [, stepTitle, stepId, stepType] = heading;
      let role = "";
      let dependsOn = "";
      for (let j = i + 1; j < lines.length; j++) {
        const raw = lines[j];
        const trimmed = raw.trim();
        if (!trimmed) break;
        if (/^\d+\.\s+\*\*/.test(trimmed)) break;
        const roleMatch = /^- Role:\s*(.+)$/i.exec(trimmed);
        if (roleMatch) role = roleMatch[1].trim();
        const dependsMatch = /^- Depends on:\s*(.+)$/i.exec(trimmed);
        if (dependsMatch) dependsOn = dependsMatch[1].trim();
      }
      steps.push({
        id: stepId.trim(),
        title: stepTitle.trim(),
        checkpoint: stepType.trim() === "checkpoint" || role === "checkpoint",
        role: role || undefined,
        dependsOn: dependsOn || undefined,
      });
    }
  }

  if (!title && specLines.length === 0 && steps.length === 0) {
    return null;
  }

  return {
    title,
    spec: specLines.join(" "),
    steps,
  };
}

function parsePlanSummary(plan: string): PlanSummary {
  const goSummary = parseGoPlan(plan);
  if (goSummary) return goSummary;
  return {
    title: "",
    spec: parseLegacyGoal(plan),
    steps: parseLegacyStepTitles(plan),
  };
}

interface Props {
  plan: string;
  onConfirm: (plan: string) => void;
  onDiscard: () => void;
}

export function PlanEditorCard({ plan, onConfirm, onDiscard }: Props) {
  const [value, setValue] = useState(plan);
  const [expertMode, setExpertMode] = useState(false);

  const summary = useMemo(() => parsePlanSummary(value), [value]);

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
            可直接编辑 Markdown。修改内容后确认即可按当前计划启动执行。
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
          {summary.title && (
            <div>
              <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">计划标题</div>
              <p className="text-xs text-gray-800 leading-relaxed font-medium">{summary.title}</p>
            </div>
          )}
          {summary.spec && (
            <div>
              <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">需求概要</div>
              <p className="text-xs text-gray-700 leading-relaxed">{summary.spec}</p>
            </div>
          )}
          <div>
            <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">
              执行步骤 ({summary.steps.length})
            </div>
            {summary.steps.length > 0 ? (
              <ol className="space-y-1">
                {summary.steps.map((step, idx) => (
                  <li key={step.id} className="flex items-start gap-2 text-xs text-gray-700">
                    <span className="text-gray-400 w-4 flex-shrink-0">{idx + 1}.</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1 flex-wrap">
                        <span>{step.title}</span>
                        {step.checkpoint && (
                          <span className="rounded bg-yellow-100 px-1 text-[10px] text-yellow-700">⏸ checkpoint</span>
                        )}
                      </div>
                      {(step.role || step.dependsOn) && (
                        <div className="mt-0.5 text-[10px] text-gray-500">
                          {step.role ? `role: ${step.role}` : ""}
                          {step.role && step.dependsOn ? " · " : ""}
                          {step.dependsOn ? `depends: ${step.dependsOn}` : ""}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-xs text-gray-400">当前计划文本没有可解析的结构化步骤，请切换到专家模式查看原始 Markdown。</p>
            )}
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
