// apps/server/src/routes/plan.ts
import { Router, Request, Response } from "express";
import { DEFAULT_CONFIG } from "../config";
import { generatePlan } from "../plan";
import type { PlanRequest, PlanResponse } from "../types";

export const planRouter = Router();

planRouter.post("/plan", async (req: Request, res: Response) => {
  const { spec, llm } = req.body as PlanRequest;

  if (!spec?.trim()) {
    res.status(400).json({ ok: false, error: "spec is required" } satisfies PlanResponse);
    return;
  }

  const workDir = process.env.WORK_DIR ?? process.cwd();
  const config = {
    ...DEFAULT_CONFIG,
    workDir,
    baseURL: llm?.baseURL?.trim() || DEFAULT_CONFIG.baseURL,
    apiKey: llm?.apiKey?.trim() || DEFAULT_CONFIG.apiKey,
  };

  try {
    const plan = await generatePlan(spec, config);
    res.json({ ok: true, plan } satisfies PlanResponse);
  } catch (error) {
    console.error("[shipyard:server:plan]", (error as Error).message);
    res.status(500).json({ ok: false, error: (error as Error).message } satisfies PlanResponse);
  }
});

// Deprecate /prd — redirect callers to /plan
planRouter.post("/prd", (_req: Request, res: Response) => {
  res.status(410).json({ deprecated: true, useInstead: "/api/plan" });
});
