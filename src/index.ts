import * as path from "path";
import * as fs from "fs";
import { run, buildHistory, type ExecutionGraph } from "./shipyard";
import { DEFAULT_CONFIG } from "./config";
import {
  getCheckpointPath,
  loadGraphCheckpoint,
  prepareGraphForResume,
  saveGraphCheckpoint,
} from "./checkpoint";

async function main() {
  const args = process.argv.slice(2);
  const resumeMode = args.includes("--resume");
  const spec = args.filter((arg) => arg !== "--resume").join(" ").trim();

  if (!resumeMode && !spec) {
    console.log("Usage: ts-node src/index.ts <spec>");
    console.log("       ts-node src/index.ts --resume");
    console.log('Example: ts-node src/index.ts "实现用户登录：接收 email/password，密码错误返回 INVALID_CREDENTIALS，成功返回 JWT token，24小时过期"');
    console.log("\nEnv vars:");
    console.log("  OPENAI_API_KEY=sk-xxx          (or ANTHROPIC_API_KEY)");
    console.log("  OPENAI_BASE_URL=https://...    (OpenAI 兼容中转地址)");
    console.log("  MODEL_PLANNING=gpt-5.1         (optional)");
    console.log("  MODEL_IMPLEMENTATION=gpt-5.1   (optional)");
    process.exit(1);
  }

  if (resumeMode && spec) {
    console.log("ℹ️  --resume 模式下会忽略新传入 spec，继续使用 checkpoint 中的 originalSpec");
  }

  const apiKey = process.env.OPENAI_API_KEY ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("Error: OPENAI_API_KEY or ANTHROPIC_API_KEY is not set");
    process.exit(1);
  }

  const config = {
    ...DEFAULT_CONFIG,
    workDir: process.cwd(),
  };

  const checkpointPath = getCheckpointPath(config.workDir);

  // output 目录策略：新任务清空；resume 保留
  const outputDir = path.join(config.workDir, "output");
  if (!resumeMode && fs.existsSync(outputDir)) fs.rmSync(outputDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
  if (resumeMode) {
    console.log("↻ Resume mode: keep existing output directory");
  }

  let runSpec = spec;
  let initialGraph: ExecutionGraph | undefined;

  if (resumeMode) {
    const loaded = loadGraphCheckpoint(config.workDir);
    const resumed = prepareGraphForResume(loaded);
    saveGraphCheckpoint(config.workDir, resumed);
    initialGraph = resumed;
    runSpec = resumed.originalSpec;
  }

  console.log("🚢 Shipyard v0.3");
  console.log(`📋 Spec: ${runSpec}`);
  if (resumeMode) console.log(`♻️ Resume from ${path.relative(config.workDir, checkpointPath)}`);
  console.log(`🤖 plan=${config.models.planning} | impl=${config.models.implementation}`);
  const baseURL = process.env.OPENAI_BASE_URL ?? process.env.ANTHROPIC_BASE_URL;
  if (baseURL) console.log(`🔀 Relay: ${baseURL}`);

  const startTime = Date.now();
  const graph = await run(runSpec, config, initialGraph);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // ── 报告 ──
  console.log("\n" + "═".repeat(55));
  console.log(`${graph.status === "done" ? "✅" : "❌"} ${graph.status.toUpperCase()} in ${elapsed}s`);

  // 节点状态总览
  const stats = graph.stats;
  console.log(`\n📊 Nodes: ${stats.byStatus.done} done, ${stats.byStatus.failed} failed, ${stats.byStatus.blocked} blocked`);
  console.log(`   Verifications: ${stats.verificationsPassed}/${stats.verificationsRun} passed`);
  console.log(`   Files: ${stats.filesGenerated} generated`);

  // 生成的文件
  if (stats.filesGenerated > 0) {
    console.log("\n📁 Generated files:");
    for (const node of graph.nodes.values()) {
      if (node.evidence?.filesWritten.length) {
        node.evidence.filesWritten.forEach((f) => {
          const exists = fs.existsSync(path.resolve(config.workDir, f.path));
          console.log(`   ${exists ? "📄" : "✗ "} ${f.path} (${f.sizeBytes}b)`);
        });
      }
    }
  }

  // 开发历史（"流链表"的人类可读版本）
  const history = buildHistory(graph);
  if (history.length > 0) {
    console.log("\n📜 Execution history:");
    history.forEach((entry, i) => {
      const icon = entry.status === "done" ? "✅" : "❌";
      console.log(`\n   ${i + 1}. ${icon} ${entry.nodeTitle}`);
      console.log(`      Spec: "${entry.specFragment.slice(0, 70)}"`);
      if (entry.filesWritten.length) {
        console.log(`      Files: ${entry.filesWritten.join(", ")}`);
      }
      entry.verifications.forEach((v) => {
        console.log(`      ${v.passed ? "✓" : "✗"} [${v.type}] ${v.summary}`);
      });
      if (entry.durationMs) {
        console.log(`      Time: ${(entry.durationMs / 1000).toFixed(1)}s`);
      }
    });
  }

  // 保存图到文件（供后续 UI 消费）
  const graphPath = saveGraphCheckpoint(config.workDir, graph);
  console.log(`\n💾 Graph saved to ${path.relative(config.workDir, graphPath)}`);
}

main().catch((e) => {
  console.error("Fatal:", (e as Error).message);
  process.exit(1);
});
