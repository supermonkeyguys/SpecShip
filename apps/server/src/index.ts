/**
 * apps/server/src/index.ts — Express 入口
 *
 * 职责：组装路由，启动 HTTP server。
 * 规则：不包含业务逻辑，只做路由注册和中间件配置。
 */

import express from "express";
import cors from "cors";
import * as path from "path";

// 项目根目录：__dirname = apps/server/src，往上三层到项目根
// 无论 tsx 从哪里启动都能正确定位 .shipyard/
const PROJECT_ROOT = path.resolve(__dirname, "../../..");
if (!process.env.WORK_DIR) process.env.WORK_DIR = PROJECT_ROOT;
import { runRouter } from "./routes/run";
import { streamRouter } from "./routes/stream";
import { nodeRouter } from "./routes/node";
import { filesRouter } from "./routes/files";
import { chatRouter } from "./routes/chat";
import { resumeRouter } from "./routes/resume";
import { projectsRouter } from "./routes/projects";
import { clarifyRouter } from "./routes/clarify";
import { previewRouter } from "./routes/preview";
import { prdRouter } from "./routes/prd";

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 5174;

// ---- 中间件 ----
app.use(cors());
app.use(express.json());

// ---- 路由 ----
app.use("/api", runRouter);
app.use("/api", streamRouter);
app.use("/api", nodeRouter);
app.use("/api", filesRouter);
app.use("/api", chatRouter);
app.use("/api", resumeRouter);
app.use("/api", projectsRouter);
app.use("/api", clarifyRouter);
app.use("/api", previewRouter);
app.use("/api", prdRouter);

// ---- 健康检查 ----
app.get("/health", (_req, res) => {
  res.json({ ok: true, version: "0.4.0" });
});

// ---- 启动 ----
app.listen(PORT, () => {
  console.log(`🚢 Shipyard server running on http://localhost:${PORT}`);
  console.log(`   SSE stream: http://localhost:${PORT}/api/stream`);
  console.log(`   POST /api/run — start a task`);
  console.log(`   GET  /api/files — list generated files`);
});

export { app };
