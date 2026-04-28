/**
 * files/useFilePreview.ts — 文件预览状态管理
 */

import { useRef, useState } from "react";
import type { FileEntry } from "../../types";
import { fetchSessionFileContent } from "../../shared/api/fileClient";
import { useWorkspaceStore } from "../../domains/workspace/store";
import type { SelectedFileIdentity } from "../../domains/workspace/types";

export interface UseFilePreviewReturn {
  selectedFile: SelectedFileIdentity | null;
  fileContent: string | null;
  fileError: string | null;
  handleFileSelect: (file: FileEntry, projectId: string, sessionId: string) => Promise<void>;
  handleClose: () => void;
}

export function useFilePreview(): UseFilePreviewReturn {
  const selectedFile = useWorkspaceStore((state) => state.selectedFile);
  const setSelectedFile = useWorkspaceStore((state) => state.setSelectedFile);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const handleFileSelect = async (file: FileEntry, projectId: string, sessionId: string) => {
    const requestId = ++requestIdRef.current;

    setSelectedFile({ projectId, sessionId, path: file.path });
    setFileContent(null);
    setFileError(null);

    try {
      const data = await fetchSessionFileContent(projectId, sessionId, file.path);

      if (requestIdRef.current !== requestId) {
        return;
      }

      setFileContent(data.content ?? "");
    } catch {
      if (requestIdRef.current !== requestId) {
        return;
      }

      setFileError("Failed to load file.");
    }
  };

  const handleClose = () => {
    requestIdRef.current += 1;
    setSelectedFile(null);
    setFileContent(null);
    setFileError(null);
  };

  return { selectedFile, fileContent, fileError, handleFileSelect, handleClose };
}
