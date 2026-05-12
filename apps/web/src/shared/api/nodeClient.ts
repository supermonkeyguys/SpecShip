import { fetchJSON } from "../../utils/fetchJSON";
import type { NodeEditRequest, NodeEditResponse } from "../../types";

export function retryNode(
  nodeId: string,
  session: { projectId: string; sessionId: string }
): Promise<{ ok: boolean; error?: string }> {
  return fetchJSON<{ ok: boolean; error?: string }>(`/api/node/${nodeId}/retry`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(session),
  });
}

export function verifyNode(
  nodeId: string,
  session: { projectId: string; sessionId: string }
): Promise<{ ok: boolean; error?: string }> {
  return fetchJSON<{ ok: boolean; error?: string }>(`/api/node/${nodeId}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(session),
  });
}

export function editNode(
  nodeId: string,
  req: NodeEditRequest
): Promise<NodeEditResponse> {
  return fetchJSON<NodeEditResponse>(`/api/node/${nodeId}/edit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
}


export function retrySession(
  session: { projectId: string; sessionId: string }
): Promise<{ ok: boolean; graphId?: string; projectId?: string; sessionId?: string; error?: string }> {
  return fetchJSON<{ ok: boolean; graphId?: string; projectId?: string; sessionId?: string; error?: string }>(`/api/session/retry`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(session),
  });
}
