import { fetchJSON } from "../../utils/fetchJSON";

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
