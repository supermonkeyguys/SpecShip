/**
 * files/useFilePreview.ts — 文件预览状态管理
 */

import { useState } from "react";
import { fetchJSON } from "../../utils/fetchJSON";
import type { FileEntry } from "../../../../server/types";

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

  const handleFileSelect = async (file: FileEntry, projectId: string, sessionId: string) => {
    setSelectedFile({ file, projectId, sessionId });
    setFileContent(null);
    try {
      const data = await fetchJSON<{ content: string }>(
        `/api/projects/${projectId}/sessions/${sessionId}/file?path=${encodeURIComponent(file.path)}`
      );
      setFileContent(data.content ?? "");
    } catch {
      setFileContent("Failed to load file.");
    }
  };

  const handleClose = () => {
    setSelectedFile(null);
    setFileContent(null);
  };

  return { selectedFile, fileContent, handleFileSelect, handleClose };
}
