/**
 * files/useFilePreview.ts — 文件预览状态管理
 */

import { useRef, useState } from "react";
import { fetchJSON } from "../../utils/fetchJSON";
import type { FileEntry } from "../../types";

export interface SelectedFile {
  file: FileEntry;
  projectId: string;
  sessionId: string;
}

export interface UseFilePreviewReturn {
  selectedFile: SelectedFile | null;
  fileContent: string | null;
  handleFileSelect: (file: FileEntry, projectId: string, sessionId: string) => Promise<void>;
  handleClose: () => void;
}

export function useFilePreview(): UseFilePreviewReturn {
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const handleFileSelect = async (file: FileEntry, projectId: string, sessionId: string) => {
    const requestId = ++requestIdRef.current;

    setSelectedFile({ file, projectId, sessionId });
    setFileContent(null);

    try {
      const data = await fetchJSON<{ content: string }>(
        `/api/projects/${projectId}/sessions/${sessionId}/file?path=${encodeURIComponent(file.path)}`
      );

      if (requestIdRef.current !== requestId) {
        return;
      }

      setFileContent(data.content ?? "");
    } catch {
      if (requestIdRef.current !== requestId) {
        return;
      }

      setFileContent("Failed to load file.");
    }
  };

  const handleClose = () => {
    requestIdRef.current += 1;
    setSelectedFile(null);
    setFileContent(null);
  };

  return { selectedFile, fileContent, handleFileSelect, handleClose };
}
