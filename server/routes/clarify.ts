/**
 * routes/clarify.ts — POST /api/clarify
 *
 * 在正式跑任务之前，先判断 spec 是否足够清晰。
 * 前端收到 needsClarification=true 时，展示问题让用户补充，
 * 用户确认后再调 POST /api/run。
 */

import { Router, Request, Response } from "express";
import { DEFAULT_CONFIG } from "../../src/config";
import { runAgent } from "../../src/llm";
import { CLARIFIER_PROMPT } from "../../src/prompts";
import { ClarifyRequest, ClarifyResponse } from "../types";

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
      questions: string[];
      confidence: string;
      summary: string;
    };

    res.json({
      ok: true,
      needsClarification: parsed.needsClarification ?? false,
      questions: parsed.questions ?? [],
      confidence: (parsed.confidence ?? "medium") as ClarifyResponse["confidence"],
      summary: parsed.summary ?? "",
    } satisfies ClarifyResponse);
  } catch (e) {
    // clarify 失败不阻塞，直接返回"不需要澄清"
    res.json({
      ok: true,
      needsClarification: false,
      questions: [],
      confidence: "medium",
      summary: spec.slice(0, 80),
    } satisfies ClarifyResponse);
  }
});
