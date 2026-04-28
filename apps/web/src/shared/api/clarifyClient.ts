import type { ClarifyQuestion } from "../../types";
import { fetchJSON } from "../../utils/fetchJSON";

export interface ClarifyResponseDTO {
  needsClarification: boolean;
  questions: ClarifyQuestion[];
}

export function clarifySpec(spec: string): Promise<ClarifyResponseDTO> {
  return fetchJSON<ClarifyResponseDTO>("/api/clarify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ spec }),
  });
}
