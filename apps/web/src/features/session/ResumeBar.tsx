/**
 * session/ResumeBar.tsx — 任务中断恢复提示条
 */

import { Alert, AlertDescription } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import type { StatusResponse } from "../../types";

interface Props {
  info: StatusResponse;
  onResume: () => void;
  onDismiss: () => void;
}

export function ResumeBar({ info, onResume, onDismiss }: Props) {
  const specPreview = info.spec?.slice(0, 50) ?? "";

  return (
    <Alert variant="warning" className="flex-shrink-0 rounded-none border-x-0 border-t-0 px-4 py-2">
      <div className="flex items-center justify-between gap-3">
        <AlertDescription className="flex min-w-0 items-center gap-2 text-xs font-mono text-amber-700">
          <Badge variant="warning" className="shrink-0 font-mono text-[11px]">
            ↻ Interrupted
          </Badge>
          <span className="min-w-0 truncate">
            "{specPreview}"
          </span>
          <span className="shrink-0 text-amber-600">
            ({info.doneCount}/{info.nodeCount} done)
          </span>
        </AlertDescription>

        <div className="flex shrink-0 gap-2">
          <Button type="button" size="sm" variant="warning" onClick={onResume}>
            Resume
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
      </div>
    </Alert>
  );
}
