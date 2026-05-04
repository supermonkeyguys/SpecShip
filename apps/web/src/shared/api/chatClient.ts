import type { ChatRequest, ChatResponse } from "../../types";
import { fetchJSON } from "../../utils/fetchJSON";
import { loadLLMSettings } from "./llmSettings";

export function chatIntent(request: ChatRequest): Promise<ChatResponse> {
  const llm = loadLLMSettings();
  return fetchJSON<ChatResponse>("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...request, llm }),
  });
}
