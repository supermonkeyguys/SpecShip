/**
 * files/FilePreview.tsx — 文件内容预览
 */

import { Button } from "../../components/ui/button";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Separator } from "../../components/ui/separator";
import { LoadingState } from "../../shared/ui/LoadingState";
import { InlineError } from "../../shared/ui/InlineError";

interface Props {
  filePath: string;
  content: string | null;
  error: string | null;
  onClose: () => void;
}

export function FilePreview({ filePath, content, error, onClose }: Props) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex flex-shrink-0 items-center justify-between gap-3 bg-gray-50 px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span aria-hidden="true" className="text-xs text-green-600">📄</span>
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-xs font-mono text-gray-700" title={filePath}>
              {filePath}
            </span>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="h-7 px-2 text-xs text-gray-500 hover:text-gray-700"
        >
          ✕ Close
        </Button>
      </div>
      <Separator />
      <ScrollArea className="flex-1">
        <div className="p-4">
          {content === null && !error ? (
            <LoadingState label="Loading file" />
          ) : error ? (
            <InlineError message={error} />
          ) : (
            <pre className="whitespace-pre-wrap text-xs leading-relaxed text-gray-700 font-mono">
              {content}
            </pre>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
