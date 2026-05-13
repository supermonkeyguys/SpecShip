import type { RunRequest, RunResponse } from "../../types";
import { fetchJSON } from "../../utils/fetchJSON";
import { loadLLMSettings } from "./llmSettings";

export function runSpec(request: { spec: string; mode?: "spec" | "plan"; repoPath?: string; strategyId?: string }): Promise<RunResponse> {
  const llm = loadLLMSettings();
  return fetchJSON<RunResponse>("/api/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...request, llm }),
  });
}
