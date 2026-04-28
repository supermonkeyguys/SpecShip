import type { ChatRequest, ChatResponse } from "../../types";
import { fetchJSON } from "../../utils/fetchJSON";

export function chatIntent(request: ChatRequest): Promise<ChatResponse> {
  return fetchJSON<ChatResponse>("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
}
