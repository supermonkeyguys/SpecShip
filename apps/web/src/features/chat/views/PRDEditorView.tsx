/**
 * PRDEditorView.tsx — PRD 草稿展示与编辑卡片
 *
 * 用户可直接编辑 AI 生成的 PRD，然后 confirm 传入执行流程。
 */

import { useState } from "react";
import { Button } from "../../../components/ui/button";
import { Textarea } from "../../../components/ui/textarea";

interface Props {
  prd: string;
  onConfirm: (prd: string) => void;
  onDiscard: () => void;
}

export function PRDEditorView({ prd, onConfirm, onDiscard }: Props) {
  const [value, setValue] = useState(prd);

  return (
    <div className="rounded-2xl border border-blue-200 overflow-hidden shadow-sm text-xs">
      <div className="bg-blue-50 border-b border-blue-200 px-4 py-2.5 flex items-center gap-2 font-semibold text-blue-800">
        <span>📋</span>
        <span>AI 生成了需求文档草稿，请确认或修改后开始执行。</span>
      </div>

      <div className="bg-white px-4 py-3">
        <Textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="min-h-[320px] w-full resize-y rounded-lg bg-gray-50 p-3 text-xs font-mono shadow-none border-gray-200 leading-relaxed"
          spellCheck={false}
        />
      </div>

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
