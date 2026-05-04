/**
 * verify.ts — Spec-derived 验证系统
 *
 * 核心思路：
 * spec 里的每一句需求描述，都应该能变成一个可执行的验证
 * 不是人工写测试，而是从 spec 自动提取验证标准
 *
 * 验证分两层：
 * 1. 确定性验证：tsc 编译、lint（客观，0/1）
 * 2. 行为验证：从 spec 提取的测试用例（运行代码验证行为）
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { VerificationCriterion, VerificationRecord } from "../graph";
import { ShipyardConfig } from "../config";
import { runAgent } from "../ai/llm";
import type { TaskStrategy, VerifierConfig } from "../strategies/base";
import { typescriptLibStrategy } from "../strategies";

// ─────────────────────────────────────────
// 层 1：确定性验证
// ─────────────────────────────────────────

export function runCompileCheck(files: string[], workDir: string): VerificationRecord {
  const start = Date.now();
  const timestamp = new Date().toISOString();

  if (files.length === 0) {
    return { type: "compile", passed: false, output: "No files to compile", durationMs: 0, timestamp };
  }

  const hasTsx = files.some((f) => f.endsWith(".tsx"));

  try {
    // .tsx 文件需要 --jsx react 和 --allowImportingTsExtensions
    // 注意：代码里必须用 React.JSX.Element，不能用全局 JSX.Element（React 19 已移除）
    const jsxFlags = hasTsx ? "--jsx react --allowImportingTsExtensions" : "";
    const cmd = `npx tsc --noEmit --target ES2022 --moduleResolution bundler --esModuleInterop --skipLibCheck ${jsxFlags} ${files.join(" ")}`;
    execSync(cmd, { cwd: workDir, encoding: "utf-8", timeout: 30_000, stdio: ["pipe", "pipe", "pipe"] });
    return { type: "compile", passed: true, output: `${files.length} file(s) compiled`, durationMs: Date.now() - start, timestamp };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string };
    const output = [err.stdout, err.stderr].filter(Boolean).join("\n").trim().slice(0, 800);
    return { type: "compile", passed: false, output, durationMs: Date.now() - start, timestamp };
  }
}

// ─────────────────────────────────────────
// 层 2：从 spec 提取验证标准
// ─────────────────────────────────────────

const SPEC_EXTRACTOR_PROMPT = `
You are a test specification extractor. Your job is to generate EXECUTABLE verification criteria from a spec and its implementation.

Given a spec fragment AND the actual implementation code, output ONLY a JSON array:
[
  {
    "id": "vc-1",
    "description": "human readable description of what is being verified",
    "type": "behavior",
    "hardness": "hard" | "soft",
    "testCase": {
      "input": "addTwoNumbers(1, 2)",
      "expectedOutput": "3",
      "expectError": null
    }
  }
]

hardness:
- "hard": must pass — objective correctness (returns exact value, throws specific error)
- "soft": best-effort — subjective or approximate (output contains string, result is truthy)

CRITICAL rules for testCase.input:
- SCAN the implementation code for exported function/class names
- Use the EXACT exported name — never guess or abbreviate
- Input must be a valid expression that can be evaluated in Node.js
- Use simple, concrete values (numbers, strings, booleans) — no complex objects unless required
- If the function is async, the test runner handles await automatically

Rules:
- Extract ONLY behaviors explicitly stated in the spec
- Generate 1-3 behavior criteria — quality over quantity
- Each criterion must be independently executable
- If spec is purely about types/interfaces with no runtime behavior, return []
- expectedOutput: use JSON-serializable value (number, string, boolean, null, array, object)
`.trim();

const BEHAVIOR_SEMANTIC_REGEX = /(returns?|throws?|errors?|success|failure|返回|抛错|抛出|错误|成功|失败)/i;

function hasBehaviorSemantics(specFragment: string): boolean {
  return BEHAVIOR_SEMANTIC_REGEX.test(specFragment);
}

export async function extractVerificationCriteria(
  specFragment: string,
  config: ShipyardConfig,
  outputFiles?: string[]
): Promise<VerificationCriterion[]> {
  // 把实际实现代码传给 LLM，让它用正确的函数名生成 testCase
  const codeContext = outputFiles
    ?.filter((f) => fs.existsSync(f))
    .map((f) => {
      const content = fs.readFileSync(f, "utf-8").slice(0, 1000);
      return `// ${path.basename(f)}\n${content}`;
    })
    .join("\n\n") ?? "";

  const userMessage = codeContext
    ? `Spec:\n${specFragment}\n\nImplementation:\n${codeContext}`
    : `Extract verification criteria from this spec:\n\n${specFragment}`;

  const { finalText: raw } = await runAgent(
    SPEC_EXTRACTOR_PROMPT,
    userMessage,
    config.workDir,
    { baseURL: config.baseURL, apiKey: config.apiKey, model: config.models.planning },
    false
  );

  try {
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return [];
    return JSON.parse(match[0]) as VerificationCriterion[];
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────
// 层 2：运行行为验证
// ─────────────────────────────────────────

export function runBehaviorVerification(
  criterion: VerificationCriterion,
  outputFiles: string[],
  workDir: string
): VerificationRecord {
  const start = Date.now();
  const timestamp = new Date().toISOString();

  if (!criterion.testCase || criterion.type !== "behavior") {
    return { type: "test", passed: true, output: "No test case to run", durationMs: 0, timestamp };
  }

  const tc = criterion.testCase;

  // 生成一个临时测试文件
  const imports = outputFiles
    .map((f) => {
      const rel = path.relative(workDir, f).replace(/\\/g, "/").replace(/\.ts$/, "");
      return `import * as mod_${path.basename(f, ".ts")} from "./${rel}";`;
    })
    .join("\n");

  const SAFE_INPUT_PATTERN = /^[\w.[\]()"'\s\-+\d.,true|false|null|undefined]+$/;
  if (!SAFE_INPUT_PATTERN.test(tc.input)) {
    return {
      type: "test",
      passed: false,
      output: `Unsafe testCase.input rejected: ${tc.input.slice(0, 100)}`,
      durationMs: 0,
      timestamp: new Date().toISOString(),
    };
  }

  // 把 input 里的函数名解析出来，找到导出该函数的模块
  const funcName = tc.input.match(/^(\w+)\(/)?.[1] ?? "";
  const matchingModule = outputFiles.find((f) => {
    if (!fs.existsSync(f)) return false;
    const content = fs.readFileSync(f, "utf-8");
    // 检查文件是否导出了该函数
    return content.includes(`export function ${funcName}`) ||
           content.includes(`export const ${funcName}`) ||
           content.includes(`export { ${funcName}`);
  }) ?? outputFiles[0]; // fallback 到第一个文件
  const moduleAlias = matchingModule ? `mod_${path.basename(matchingModule, ".ts")}` : "mod";

  const testCode = `
${imports}

async function runTest() {
  try {
    const result = await ${moduleAlias}.${tc.input};
    ${tc.expectError
      ? `console.error("FAIL: expected error ${tc.expectError} but got result:", result); process.exit(1);`
      : tc.expectedOutput
        ? `const expected = ${tc.expectedOutput};
    const ok = JSON.stringify(result) === JSON.stringify(expected) || String(result).includes(String(expected));
    if (!ok) { console.error("FAIL: expected", expected, "got", result); process.exit(1); }
    console.log("PASS");`
        : `console.log("PASS: returned", typeof result);`
    }
  } catch (e) {
    ${tc.expectError
      ? `const msg = String(e);
    if (msg.includes("${tc.expectError}") || (e as any)?.code === "${tc.expectError}") {
      console.log("PASS: got expected error ${tc.expectError}");
    } else {
      console.error("FAIL: expected error ${tc.expectError}, got:", msg);
      process.exit(1);
    }`
      : `console.error("FAIL: unexpected error:", e); process.exit(1);`
    }
  }
}

runTest().catch(e => { console.error(e); process.exit(1); });
`.trim();

  const tmpFile = path.join(workDir, `.shipyard-verify-${Date.now()}.ts`);

  try {
    fs.writeFileSync(tmpFile, testCode);
    const compilerOptions = JSON.stringify({ module: "commonjs", esModuleInterop: true }).replace(/"/g, '\\"');
    const output = execSync(
      `npx ts-node --skipProject --compiler-options "${compilerOptions}" "${tmpFile}"`,
      { cwd: workDir, encoding: "utf-8", timeout: 15_000, stdio: ["pipe", "pipe", "pipe"] }
    );
    return { type: "test", passed: true, output: output.trim().slice(0, 200), durationMs: Date.now() - start, timestamp };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string };
    const output = [err.stdout, err.stderr].filter(Boolean).join("\n").trim().slice(0, 300);
    return { type: "test", passed: false, output, durationMs: Date.now() - start, timestamp };
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
}

// ─────────────────────────────────────────
// 层 3：Lint 检查（软失败，仅警告）
// ─────────────────────────────────────────

/**
 * 检测工作目录是否有 eslint/biome 配置，如有则对指定文件运行 lint。
 * 返回 null 表示项目无 lint 工具，跳过。
 * lint 失败永远是 soft — 记录警告但不阻塞节点。
 */
export function runLintCheck(files: string[], workDir: string): VerificationRecord | null {
  if (files.length === 0) return null;

  const start = Date.now();
  const timestamp = new Date().toISOString();

  // 检测可用的 lint 工具（按优先级）
  const hasBiome = fs.existsSync(path.join(workDir, "biome.json")) ||
                   fs.existsSync(path.join(workDir, "biome.jsonc"));
  const hasEslint = fs.existsSync(path.join(workDir, ".eslintrc")) ||
                    fs.existsSync(path.join(workDir, ".eslintrc.js")) ||
                    fs.existsSync(path.join(workDir, ".eslintrc.cjs")) ||
                    fs.existsSync(path.join(workDir, ".eslintrc.json")) ||
                    fs.existsSync(path.join(workDir, ".eslintrc.yml")) ||
                    fs.existsSync(path.join(workDir, "eslint.config.js")) ||
                    fs.existsSync(path.join(workDir, "eslint.config.mjs")) ||
                    fs.existsSync(path.join(workDir, "eslint.config.cjs"));

  if (!hasBiome && !hasEslint) return null;

  // 只 lint TypeScript 文件，跳过 test/spec 文件
  const lintableFiles = files.filter((f) =>
    (f.endsWith(".ts") || f.endsWith(".tsx")) &&
    !f.endsWith(".test.ts") &&
    !f.endsWith(".spec.ts") &&
    fs.existsSync(f)
  );
  if (lintableFiles.length === 0) return null;

  const relFiles = lintableFiles.map((f) => path.relative(workDir, f)).join(" ");

  try {
    let cmd: string;
    if (hasBiome) {
      cmd = `npx biome check --no-errors-on-unmatched ${relFiles}`;
    } else {
      cmd = `npx eslint --max-warnings=0 ${relFiles}`;
    }

    execSync(cmd, {
      cwd: workDir,
      encoding: "utf-8",
      timeout: 30_000,
      stdio: ["pipe", "pipe", "pipe"],
    });

    return {
      type: "lint",
      passed: true,
      output: `${hasBiome ? "biome" : "eslint"}: no issues`,
      durationMs: Date.now() - start,
      timestamp,
    };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string };
    const output = [err.stdout, err.stderr].filter(Boolean).join("\n").trim().slice(0, 500);
    return {
      type: "lint",
      passed: false,
      output,
      durationMs: Date.now() - start,
      timestamp,
    };
  }
}

// ─────────────────────────────────────────
// 完整验证流程：对一个节点跑所有验证
// ─────────────────────────────────────────

export interface NodeVerificationResult {
  passed: boolean;
  records: VerificationRecord[];
  summary: string;
}

/**
 * tester 节点专用验证：
 * 在 output 目录创建临时测试环境（symlink node_modules），用 vitest 实际运行测试文件
 */
async function runTesterNodeVerification(
  outputFiles: string[],
  workDir: string
): Promise<NodeVerificationResult> {
  const records: VerificationRecord[] = [];
  const testFiles = outputFiles.filter((f) => f.includes(".test.") || f.includes(".spec."));

  if (testFiles.length === 0) {
    return { passed: true, records, summary: "No test files found, skipping tester verification" };
  }

  // 策略：把 node_modules symlink 和 vitest.config 直接放在 output/ 目录
  // 这样 vitest 从 output/ 出发解析所有 import，路径关系与代码一致
  // outputFiles 是绝对路径，取第一个文件所在目录作为 output 目录
  const outputDir = path.dirname(path.resolve(testFiles[0]));
  const monorepoRoot = path.resolve(__dirname, "../../../../");
  const nmLink = path.join(outputDir, "node_modules");
  const vitestConfigPath = path.join(outputDir, "__shipyard_vitest.config.ts");

  let createdNmLink = false;

  try {
    // 1. 在 output/ 创建 node_modules symlink → monorepo 根的 node_modules
    if (!fs.existsSync(nmLink)) {
      const nmTarget = path.join(monorepoRoot, "node_modules");
      if (fs.existsSync(nmTarget)) {
        fs.symlinkSync(nmTarget, nmLink, "dir");
        createdNmLink = true;
      }
    }

    // 2. 在 output/ 生成 vitest.config.ts（无需 alias，node_modules 已在同目录）
    const testFilePaths = JSON.stringify(testFiles.map((f) => path.resolve(f)));
    // 用 node require 解析 react 真实物理路径（避免 pnpm symlink 导致多实例）
    const webNM = path.resolve(monorepoRoot, "apps/web/node_modules");
    const reactPhysical = path.dirname(require.resolve("react", { paths: [webNM] }));
    const reactDomPhysical = path.dirname(require.resolve("react-dom", { paths: [webNM] }));
    const vitestConfig = [
      "import { defineConfig } from 'vitest/config';",
      "export default defineConfig({",
      "  resolve: {",
      "    alias: {",
      `      react: ${JSON.stringify(reactPhysical)},`,
      `      'react-dom': ${JSON.stringify(reactDomPhysical)},`,
      `      'react-dom/client': ${JSON.stringify(reactDomPhysical + "/client")},`,
      "    },",
      "  },",
      "  test: {",
      "    environment: 'jsdom',",
      "    globals: true,",
      `    include: ${testFilePaths},`,
      "    setupFiles: [],",
      "  },",
      "});",
    ].join("\n");
    fs.writeFileSync(vitestConfigPath, vitestConfig);

    // 3. 在 output/ 目录执行 vitest，它能正确解析 react 等依赖
    const start = Date.now();
    const timestamp = new Date().toISOString();
    const vitestBin = path.join(monorepoRoot, "node_modules/.bin/vitest");
    try {
      const out = execSync(
        `${vitestBin} run --config "${vitestConfigPath}"`,
        { cwd: outputDir, encoding: "utf-8", timeout: 60_000, stdio: ["pipe", "pipe", "pipe"] }
      );
      records.push({ type: "test", passed: true, output: out.slice(0, 500), durationMs: Date.now() - start, timestamp });
      return { passed: true, records, summary: "Tests passed" };
    } catch (e: unknown) {
      const err = e as { stdout?: string; stderr?: string };
      const output = [err.stdout, err.stderr].filter(Boolean).join("\n").trim().slice(0, 800);
      records.push({ type: "test", passed: false, output, durationMs: Date.now() - start, timestamp });
      return { passed: false, records, summary: `Tests failed: ${output.split("\n")[0]}` };
    }
  } finally {
    // 清理：只删 symlink 和临时 config，不动 output/ 里的代码文件
    try { if (createdNmLink && fs.lstatSync(nmLink).isSymbolicLink()) fs.unlinkSync(nmLink); } catch { /**/ }
    try { if (fs.existsSync(vitestConfigPath)) fs.unlinkSync(vitestConfigPath); } catch { /**/ }
  }
}


export async function verifyNode(
  specFragment: string,
  outputFiles: string[],
  workDir: string,
  config: ShipyardConfig,
  nodeRole?: string,
  strategy?: TaskStrategy
): Promise<NodeVerificationResult> {
  const verifierConfig: VerifierConfig = (strategy ?? typescriptLibStrategy).verify();

  // tester 节点：走独立的测试执行环境，而非普通 compile check
  if (nodeRole === "tester") {
    return runTesterNodeVerification(outputFiles, workDir);
  }

  const records: VerificationRecord[] = [];

  // 1. 编译检查（由 VerifierConfig 控制）
  if (verifierConfig.compile) {
    const compileResult = runCompileCheck(outputFiles, workDir);
    records.push(compileResult);

    if (!compileResult.passed) {
      return {
        passed: false,
        records,
        summary: `Compile failed: ${compileResult.output.split("\n")[0]}`,
      };
    }
  }

  // 2. 检查文件是否有可执行的实现（纯类型文件跳过行为验证）
  const hasImplementation = outputFiles.some((f) => {
    if (!fs.existsSync(f)) return false;
    const content = fs.readFileSync(f, "utf-8");
    return content.includes("export function") || content.includes("export const") || content.includes("export class");
  });

  if (!hasImplementation) {
    return { passed: true, records, summary: `Compile passed (types-only file, skipping behavior tests)` };
  }

  // 3. 从 spec 提取行为验证标准（仅在 spec 明确包含行为语义且 VerifierConfig 启用时触发）
  if (verifierConfig.behavior) {
    const shouldExtractBehaviorCriteria = hasBehaviorSemantics(specFragment);
    const criteria = shouldExtractBehaviorCriteria
      ? await extractVerificationCriteria(specFragment, config, outputFiles)
      : [];
    const behaviorCriteria = criteria.filter((c) => c.type === "behavior");

    // 含行为语义但无法提取任何行为验证标准时，视为验证失败，走重试链
    if (shouldExtractBehaviorCriteria && behaviorCriteria.length === 0) {
      records.push({
        type: "spec_check",
        passed: false,
        output: "Spec contains behavior semantics but no executable verification criteria were extracted",
        durationMs: 0,
        timestamp: new Date().toISOString(),
      });

      return {
        passed: false,
        records,
        summary: "Behavioral spec check failed: no verification criteria extracted",
      };
    }

    // 4. 运行行为验证（区分 hard/soft）
    const behaviorResults: Array<{ criterion: VerificationCriterion; record: VerificationRecord }> = [];
    for (const criterion of behaviorCriteria) {
      const result = runBehaviorVerification(criterion, outputFiles, workDir);
      records.push(result);
      behaviorResults.push({ criterion, record: result });
      const isHard = criterion.hardness !== "soft";
      console.log(`    ${result.passed ? "✅" : isHard ? "❌" : "⚠️ "} ${criterion.description}${!isHard ? " (soft)" : ""}`);
    }

    const hardBehaviorFailed = behaviorResults.some(({ criterion, record }) => !record.passed && criterion.hardness !== "soft");
    if (hardBehaviorFailed) {
      const failCount = records.filter((record) => !record.passed).length;
      return { passed: false, records, summary: `${failCount}/${records.length} check(s) failed` };
    }
  }

  // 5. 执行已有 *.test.ts 文件（如果存在）
  const testFileRecords: VerificationRecord[] = [];
  const testFiles = outputFiles.flatMap((f) => {
    const base = f.replace(/\.ts$/, "");
    const candidates = [`${base}.test.ts`, `${base}.spec.ts`];
    return candidates.filter((c) => fs.existsSync(c));
  });

  for (const testFile of testFiles) {
    const start = Date.now();
    const timestamp = new Date().toISOString();
    try {
      const compilerOptions = JSON.stringify({ module: "commonjs", esModuleInterop: true }).replace(/"/g, '\\"');
      const out = execSync(
        `npx ts-node --skipProject --compiler-options "${compilerOptions}" "${testFile}"`,
        { cwd: workDir, encoding: "utf-8", timeout: 30_000, stdio: ["pipe", "pipe", "pipe"] }
      );
      const record: VerificationRecord = {
        type: "test",
        passed: true,
        output: out.trim().slice(0, 300),
        durationMs: Date.now() - start,
        timestamp,
      };
      records.push(record);
      testFileRecords.push(record);
      console.log(`    ✅ ${path.basename(testFile)}`);
    } catch (e: unknown) {
      const err = e as { stdout?: string; stderr?: string };
      const output = [err.stdout, err.stderr].filter(Boolean).join("\n").trim().slice(0, 400);
      const record: VerificationRecord = {
        type: "test",
        passed: false,
        output,
        durationMs: Date.now() - start,
        timestamp,
      };
      records.push(record);
      testFileRecords.push(record);
      console.log(`    ❌ ${path.basename(testFile)}: ${output.split("\n")[0]}`);
    }
  }

  // 6. Lint 检查（由 VerifierConfig 控制，软失败 — 不阻塞节点）
  if (verifierConfig.lint) {
    const lintResult = runLintCheck(outputFiles, workDir);
    if (lintResult) {
      records.push(lintResult);
      console.log(`    ${lintResult.passed ? "✅" : "⚠️ "} lint${!lintResult.passed ? ` (soft): ${lintResult.output.split("\n")[0]}` : ""}`);
    }
  }

  const testFileFailed = testFileRecords.some((record) => !record.passed);
  const passed = !testFileFailed;
  const failCount = records.filter((record) => !record.passed).length;

  return {
    passed,
    records,
    summary: passed
      ? failCount === 0
        ? `All ${records.length} check(s) passed`
        : `Hard checks passed; ${failCount} soft check(s) failed`
      : `${failCount}/${records.length} check(s) failed`,
  };
}
