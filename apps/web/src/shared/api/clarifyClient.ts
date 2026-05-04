import type { ClarifyOption, ClarifyQuestion } from "../../types";
import { fetchJSON } from "../../utils/fetchJSON";
import { loadLLMSettings } from "./llmSettings";

export interface ClarifyResponseDTO {
  needsClarification: boolean;
  questions: ClarifyQuestion[];
}

function normalizeOption(option: unknown, index: number): ClarifyOption | null {
  if (typeof option === "string") {
    const label = option.trim();
    if (!label) return null;
    return {
      id: `opt-${index + 1}`,
      label,
      description: "",
    };
  }

  if (!option || typeof option !== "object") return null;

  const raw = option as Record<string, unknown>;
  const label = [raw.label, raw.text, raw.name, raw.value].find(
    (value): value is string => typeof value === "string" && value.trim().length > 0
  );

  if (!label) return null;

  const idSource = [raw.id, raw.value, raw.key].find(
    (value): value is string => typeof value === "string" && value.trim().length > 0
  );
  const description = [raw.description, raw.desc, raw.hint].find(
    (value): value is string => typeof value === "string" && value.trim().length > 0
  );

  return {
    id: idSource ?? `opt-${index + 1}`,
    label,
    description: description ?? "",
  };
}

function normalizeQuestion(question: unknown, index: number): ClarifyQuestion | null {
  if (typeof question === "string") {
    const text = question.trim();
    if (!text) return null;
    return {
      id: `q${index + 1}`,
      text,
      mode: "free",
    };
  }

  if (!question || typeof question !== "object") return null;

  const raw = question as Record<string, unknown>;
  const text = [raw.text, raw.question, raw.prompt, raw.label, raw.title].find(
    (value): value is string => typeof value === "string" && value.trim().length > 0
  );

  const rawOptions = [raw.options, raw.choices, raw.selections].find(Array.isArray) as
    | unknown[]
    | undefined;
  const options = rawOptions?.map(normalizeOption).filter((value): value is ClarifyOption => value !== null) ?? [];

  const rawMode = [raw.mode, raw.type, raw.kind, raw.inputType].find(
    (value): value is string => typeof value === "string" && value.trim().length > 0
  );
  const mode = options.length > 0 || ["options", "choice", "choices", "select"].includes(rawMode ?? "")
    ? "options"
    : "free";

  return {
    id:
      (typeof raw.id === "string" && raw.id.trim().length > 0 ? raw.id : null) ??
      `q${index + 1}`,
    text: text ?? `Question ${index + 1}`,
    mode,
    options: mode === "options" ? options : undefined,
  };
}

export async function clarifySpec(spec: string): Promise<ClarifyResponseDTO> {
  const llm = loadLLMSettings();
  const data = await fetchJSON<{ needsClarification?: boolean; questions?: unknown[] }>("/api/clarify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ spec, llm }),
  });

  const questions = (data.questions ?? [])
    .map(normalizeQuestion)
    .filter((value): value is ClarifyQuestion => value !== null);

  return {
    needsClarification: Boolean(data.needsClarification) && questions.length > 0,
    questions,
  };
}
