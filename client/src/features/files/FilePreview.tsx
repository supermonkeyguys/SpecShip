/**
 * files/FilePreview.tsx — 文件内容预览
 */

import type { FileEntry } from "../../../../server/types";

interface Props {
  file: FileEntry;
  content: string | null;
  onClose: () => void;
}

export function FilePreview({ file, content, onClose }: Props) {
  const size = file.sizeBytes < 1024
    ? `${file.sizeBytes}b`
    : `${(file.sizeBytes / 1024).toFixed(1)}k`;

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-gray-50 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-green-600 text-xs">📄</span>
          <span className="text-gray-700 text-xs font-mono">{file.path}</span>
          <span className="text-gray-400 text-xs">{size}</span>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-700 text-xs px-2 py-1 rounded hover:bg-gray-200 transition-colors"
        >
          ✕ Close
        </button>
      </div>
      <div className="flex-1 overflow-auto p-4">
        {content === null ? (
          <div className="text-gray-400 text-xs animate-pulse">Loading...</div>
        ) : (
          <pre className="text-gray-700 text-xs font-mono whitespace-pre-wrap leading-relaxed">
            {content}
          </pre>
        )}
      </div>
    </div>
  );
}
