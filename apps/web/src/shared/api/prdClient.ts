import { fetchJSON } from "../../utils/fetchJSON";
import { loadLLMSettings } from "./llmSettings";

export async function generatePRD(
  spec: string,
  opts?: { projectId?: string; sessionId?: string }
): Promise<string> {
  const llm = loadLLMSettings();
  const data = await fetchJSON<{ ok: boolean; prd?: string; error?: string }>("/api/prd", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ spec, llm, ...opts }),
  });

  if (!data.ok || !data.prd) {
    throw new Error(data.error ?? "PRD generation failed");
  }

  return data.prd;
}
