import type { LLMSettingsPayload, LLMSettingsResponse } from "../../types";
import { fetchJSON } from "../../utils/fetchJSON";

export const LLM_SETTINGS_STORAGE_KEY = "shipyard.llm.settings.v1";

export interface LLMSettings extends LLMSettingsPayload {}

export const EMPTY_LLM_SETTINGS: LLMSettings = {
  baseURL: "",
  apiKey: "",
};

function normalizeSettings(value: unknown): LLMSettings {
  if (!value || typeof value !== "object") return { ...EMPTY_LLM_SETTINGS };
  const raw = value as Record<string, unknown>;
  return {
    baseURL: typeof raw.baseURL === "string" ? raw.baseURL : "",
    apiKey: typeof raw.apiKey === "string" ? raw.apiKey : "",
  };
}

export function loadLLMSettings(): LLMSettings {
  try {
    const raw = localStorage.getItem(LLM_SETTINGS_STORAGE_KEY);
    if (!raw) return { ...EMPTY_LLM_SETTINGS };
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return { ...EMPTY_LLM_SETTINGS };
  }
}

export function saveLLMSettings(next: LLMSettings): void {
  localStorage.setItem(LLM_SETTINGS_STORAGE_KEY, JSON.stringify(next));
}

export async function fetchLLMSettings(): Promise<LLMSettings> {
  const data = await fetchJSON<LLMSettingsResponse>("/api/settings/llm");
  const normalized = normalizeSettings(data);
  saveLLMSettings(normalized);
  return normalized;
}

export async function persistLLMSettings(next: LLMSettings): Promise<LLMSettings> {
  const data = await fetchJSON<LLMSettingsResponse>("/api/settings/llm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(next),
  });
  const normalized = normalizeSettings(data);
  saveLLMSettings(normalized);
  return normalized;
}
