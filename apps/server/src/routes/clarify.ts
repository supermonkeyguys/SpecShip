/**
 * routes/clarify.ts — POST /api/clarify
 *
 * 在正式跑任务之前，先判断 spec 是否足够清晰。
 * 前端收到 needsClarification=true 时，渲染 ClarificationCard。
 */

import { Router, Request, Response } from "express";
import { DEFAULT_CONFIG } from "../config";
import { runAgent } from "../llm";
import { CLARIFIER_PROMPT } from "../prompts";
import { ClarifyRequest, ClarifyResponse, ClarifyQuestion } from "../types";

export const clarifyRouter = Router();

clarifyRouter.post("/clarify", async (req: Request, res: Response) => {
  const { spec } = req.body as ClarifyRequest;

  if (!spec?.trim()) {
    res.status(400).json({ ok: false, needsClarification: false, questions: [], confidence: "low", summary: "" });
    return;
  }

  const config = { ...DEFAULT_CONFIG, workDir: process.cwd() };

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

    // Fallback: handle both old string[] format and new ClarifyQuestion[] format
    const questions: ClarifyQuestion[] = (parsed.questions ?? []).map((q, i) => {
      if (typeof q === "string") {
        return { id: `q${i + 1}`, text: q, mode: "free" as const };
      }
      const typed = q as Record<string, unknown>;
      return {
        id: typeof typed.id === "string" ? typed.id : `q${i + 1}`,
        text: typeof typed.text === "string" ? typed.text : String(q),
        mode: typed.mode === "options" ? "options" as const : "free" as const,
        options: Array.isArray(typed.options) ? typed.options as ClarifyQuestion["options"] : undefined,
      };
    });

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
