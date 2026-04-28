import type { RunRequest, RunResponse } from "../../types";
import { fetchJSON } from "../../utils/fetchJSON";

export function runSpec(request: RunRequest): Promise<RunResponse> {
  return fetchJSON<RunResponse>("/api/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
}
