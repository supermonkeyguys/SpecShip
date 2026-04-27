/**
 * session/ResumeBar.tsx — 任务中断恢复提示条
 */

import type { StatusResponse } from "../../../../server/types";

interface Props {
  info: StatusResponse;
  onResume: () => void;
  onDismiss: () => void;
}

export function ResumeBar({ info, onResume, onDismiss }: Props) {
  return (
    <div className="flex items-center justify-between px-4 py-2 bg-amber-50 border-b border-amber-200 flex-shrink-0">
      <span className="text-amber-700 text-xs font-mono">
        ↻ Interrupted: "{info.spec?.slice(0, 50)}"
        ({info.doneCount}/{info.nodeCount} done)
      </span>
      <div className="flex gap-2">
        <button
          onClick={onResume}
          className="text-xs px-3 py-1 bg-amber-500 hover:bg-amber-400 rounded text-white transition-colors"
        >
          Resume
        </button>
        <button
          onClick={onDismiss}
          className="text-xs px-3 py-1 bg-gray-200 hover:bg-gray-300 rounded text-gray-600 transition-colors"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
