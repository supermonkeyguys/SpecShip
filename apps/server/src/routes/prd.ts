/**
 * routes/prd.ts — POST /api/prd
 *
 * 接收用户粗略需求，调用 LLM 生成 PRD 草稿（Markdown），
 * 同时持久化到 session 目录（prd.md）。
 */

import { Router, Request, Response } from "express";
import { DEFAULT_CONFIG } from "../config";
import { generatePRD } from "../prd";
import type { PRDRequest, PRDResponse } from "../types";

export const prdRouter = Router();

prdRouter.post("/prd", async (req: Request, res: Response) => {
  const { spec, projectId, sessionId, llm } = req.body as PRDRequest;

  if (!spec?.trim()) {
    res.status(400).json({ ok: false, error: "spec is required" } satisfies PRDResponse);
    return;
  }

  const workDir = process.env.WORK_DIR ?? process.cwd();

  const config = {
    ...DEFAULT_CONFIG,
    workDir,
    baseURL: llm?.baseURL?.trim() || DEFAULT_CONFIG.baseURL,
    apiKey: llm?.apiKey?.trim() || DEFAULT_CONFIG.apiKey,
    ...(projectId ? { projectId } : {}),
    ...(sessionId ? { sessionId } : {}),
  };

  try {
    const prd = await generatePRD(spec, config);
    res.json({ ok: true, prd } satisfies PRDResponse);
  } catch (error) {
    console.error("[shipyard:server:prd]", (error as Error).message);
    res.status(500).json({ ok: false, error: (error as Error).message } satisfies PRDResponse);
  }
});
