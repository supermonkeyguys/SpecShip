import type { ProjectsResponse } from "../../types";
import { fetchJSON } from "../../utils/fetchJSON";

export function fetchProjects(): Promise<ProjectsResponse> {
  return fetchJSON<ProjectsResponse>("/api/projects");
}

export function deleteSession(projectId: string, sessionId: string): Promise<{ ok: boolean }> {
  return fetchJSON<{ ok: boolean }>(`/api/projects/${projectId}/sessions/${sessionId}`, {
    method: "DELETE",
  });
}

export function deleteProject(projectId: string): Promise<{ ok: boolean }> {
  return fetchJSON<{ ok: boolean }>(`/api/projects/${projectId}`, {
    method: "DELETE",
  });
}

export function starSession(projectId: string, sessionId: string, starred: boolean): Promise<{ ok: boolean }> {
  return fetchJSON<{ ok: boolean }>(`/api/projects/${projectId}/sessions/${sessionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ starred }),
  });
}
