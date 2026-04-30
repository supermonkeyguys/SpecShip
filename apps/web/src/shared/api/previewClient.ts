import type { PreviewStatusResponse } from "../../types";
import { fetchJSON } from "../../utils/fetchJSON";

export function fetchSessionPreview(projectId: string, sessionId: string): Promise<PreviewStatusResponse> {
  return fetchJSON<PreviewStatusResponse>(`/api/projects/${projectId}/sessions/${sessionId}/preview`);
}

export function startSessionLivePreview(projectId: string, sessionId: string): Promise<PreviewStatusResponse> {
  return fetchJSON<PreviewStatusResponse>(`/api/projects/${projectId}/sessions/${sessionId}/preview/live/start`, {
    method: "POST",
  });
}

export function stopSessionLivePreview(projectId: string, sessionId: string): Promise<PreviewStatusResponse> {
  return fetchJSON<PreviewStatusResponse>(`/api/projects/${projectId}/sessions/${sessionId}/preview/live/stop`, {
    method: "POST",
  });
}
