import type { FileEntry } from "../../types";
import { fetchJSON } from "../../utils/fetchJSON";

export function fetchSessionFiles(projectId: string, sessionId: string): Promise<{ files: FileEntry[] }> {
  return fetchJSON<{ files: FileEntry[] }>(`/api/projects/${projectId}/sessions/${sessionId}/files`);
}

export function fetchSessionFileContent(
  projectId: string,
  sessionId: string,
  filePath: string
): Promise<{ content: string }> {
  return fetchJSON<{ content: string }>(
    `/api/projects/${projectId}/sessions/${sessionId}/file?path=${encodeURIComponent(filePath)}`
  );
}
