/**
 * worker.ts — Temporal Worker 入口
 *
 * 启动方式：
 *   pnpm temporal:worker
 *
 * 依赖（需要先启动）：
 *   temporal server start-dev
 *
 * 环境变量：
 *   TEMPORAL_ADDRESS     Temporal server 地址（默认 localhost:7233）
 *   TEMPORAL_NAMESPACE   命名空间（默认 default）
 *   TEMPORAL_TASK_QUEUE  Task Queue 名称（默认 specship-main）
 *   OPENAI_API_KEY       LLM API Key（Activities 调用 LLM 时需要）
 *   OPENAI_BASE_URL      LLM 中转地址（可选）
 */

import { Worker, NativeConnection } from "@temporalio/worker";
import * as path from "path";
import { specRunActivities } from "../activities/spec-run.activities";

const TEMPORAL_ADDRESS   = process.env.TEMPORAL_ADDRESS   ?? "localhost:7233";
const TEMPORAL_NAMESPACE = process.env.TEMPORAL_NAMESPACE ?? "default";
const TASK_QUEUE         = process.env.TEMPORAL_TASK_QUEUE ?? "specship-main";

async function main() {
  console.log("🔧 Shipyard Temporal Worker");
  console.log(`   Server:     ${TEMPORAL_ADDRESS}`);
  console.log(`   Namespace:  ${TEMPORAL_NAMESPACE}`);
  console.log(`   Task Queue: ${TASK_QUEUE}`);
  console.log(`   Workflows:  ${path.resolve(__dirname, "../workflows/spec-run.workflow")}`);
  console.log("");

  const connection = await NativeConnection.connect({ address: TEMPORAL_ADDRESS });

  const worker = await Worker.create({
    connection,
    namespace: TEMPORAL_NAMESPACE,
    taskQueue: TASK_QUEUE,

    // Workflow 代码路径（Temporal 会 bundle 这个文件）
    workflowsPath: require.resolve("../workflows/spec-run.workflow"),

    // Activities 实现
    activities: specRunActivities,
  });

  console.log("✅ Worker started, polling for tasks...");
  console.log("   Press Ctrl+C to stop\n");

  // graceful shutdown on SIGINT/SIGTERM
  const shutdown = async () => {
    console.log("\n⏹  Shutting down worker...");
    worker.shutdown();
    await worker.run().catch(() => {});
    await connection.close();
    process.exit(0);
  };
  process.on("SIGINT",  shutdown);
  process.on("SIGTERM", shutdown);

  await worker.run();
}

main().catch((e) => {
  console.error("Worker fatal error:", (e as Error).message);
  process.exit(1);
});
