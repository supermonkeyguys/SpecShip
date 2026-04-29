/**
 * routes/clarify.ts — POST /api/clarify
 *
 * 在正式跑任务之前，先判断 spec 是否足够清晰。
 * 前端收到 needsClarification=true 时，渲染 ClarificationCard。
 */

import { Router, Request, Response } from "express";
import { DEFAULT_CONFIG } from "../config";
import { runAgent } from "../llm";
import { decideClarificationByPolicy } from "../ai/policy";
import { CLARIFIER_PROMPT } from "../prompts";
import { ClarifyRequest, ClarifyResponse, ClarifyQuestion } from "../types";

export const clarifyRouter = Router();

function normalizeOption(option: unknown, index: number): NonNullable<ClarifyQuestion["options"]>[number] | null {
  if (typeof option === "string") {
    const label = option.trim();
    if (!label) return null;
    return { id: `opt-${index + 1}`, label, description: "" };
  }

  if (!option || typeof option !== "object") return null;

  const raw = option as Record<string, unknown>;
  const label = [raw.label, raw.text, raw.name, raw.value].find(
    (value): value is string => typeof value === "string" && value.trim().length > 0
  );
  if (!label) return null;

  const id = [raw.id, raw.value, raw.key].find(
    (value): value is string => typeof value === "string" && value.trim().length > 0
  ) ?? `opt-${index + 1}`;
  const description = [raw.description, raw.desc, raw.hint].find(
    (value): value is string => typeof value === "string" && value.trim().length > 0
  ) ?? "";

  return { id, label, description };
}

function normalizeQuestion(question: unknown, index: number): ClarifyQuestion | null {
  if (typeof question === "string") {
    const text = question.trim();
    if (!text) return null;
    return { id: `q${index + 1}`, text, mode: "free" };
  }

  if (!question || typeof question !== "object") return null;

  const raw = question as Record<string, unknown>;
  const text = [raw.text, raw.question, raw.prompt, raw.label, raw.title].find(
    (value): value is string => typeof value === "string" && value.trim().length > 0
  );
  const rawOptions = [raw.options, raw.choices, raw.selections].find(Array.isArray) as unknown[] | undefined;
  const options = rawOptions?.map(normalizeOption).filter((value): value is NonNullable<ClarifyQuestion["options"]>[number] => value !== null) ?? [];
  const rawMode = [raw.mode, raw.type, raw.kind, raw.inputType].find(
    (value): value is string => typeof value === "string" && value.trim().length > 0
  );
  const mode = options.length > 0 || ["options", "choice", "choices", "select"].includes(rawMode ?? "")
    ? "options"
    : "free";

  return {
    id: (typeof raw.id === "string" && raw.id.trim().length > 0 ? raw.id : `q${index + 1}`),
    text: text ?? `Question ${index + 1}`,
    mode,
    options: mode === "options" ? options : undefined,
  };
}

clarifyRouter.post("/clarify", async (req: Request, res: Response) => {
  const { spec } = req.body as ClarifyRequest;

  if (!spec?.trim()) {
    res.status(400).json({ ok: false, needsClarification: false, questions: [], confidence: "low", summary: "" });
    return;
  }

  const config = { ...DEFAULT_CONFIG, workDir: process.cwd() };

  const policyDecision = decideClarificationByPolicy(spec);
  if (policyDecision) {
    res.json({
      ok: true,
      needsClarification: policyDecision.needsClarification,
      questions: policyDecision.questions,
      confidence: policyDecision.confidence,
      summary: policyDecision.summary,
    } satisfies ClarifyResponse);
    return;
  }

  try {
    const { finalText } = await runAgent(
      CLARIFIER_PROMPT,
      `Spec: ${spec}`,
      config.workDir,
      { baseURL: config.baseURL, apiKey: config.apiKey, model: config.models.planning },
      false
    );

    const match = finalText.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON");

    const parsed = JSON.parse(match[0]) as {
      needsClarification: boolean;
      questions: unknown[];
      confidence: string;
      summary: string;
    };

    const questions: ClarifyQuestion[] = (parsed.questions ?? [])
      .map((q, i) => normalizeQuestion(q, i))
      .filter((value): value is ClarifyQuestion => value !== null);

    res.json({
      ok: true,
      needsClarification: parsed.needsClarification ?? false,
      questions: (parsed.needsClarification ?? false) ? questions : [],
      confidence: (parsed.confidence ?? "medium") as ClarifyResponse["confidence"],
      summary: parsed.summary ?? "",
    } satisfies ClarifyResponse);
  } catch {
    res.json({
      ok: true,
      needsClarification: false,
      questions: [],
      confidence: "medium",
      summary: spec.slice(0, 80),
    } satisfies ClarifyResponse);
  }
});
