// apps/web/src/shared/api/planClient.ts
import { fetchJSON } from "../../utils/fetchJSON";
import { loadLLMSettings } from "./llmSettings";
import type { PlanRequest, PlanResponse } from "../../types";

export async function generatePlan(spec: string): Promise<string> {
  const llm = loadLLMSettings();
  const data = await fetchJSON<PlanResponse>("/api/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ spec, llm } satisfies PlanRequest),
  });

  if (!data.ok || !data.plan) {
    throw new Error(data.error ?? "Plan generation failed");
  }

  return data.plan;
}
