/**
 * verify.ts — Spec-derived 验证系统
 *
 * 核心思路：
 * 先保证生成产物在结构上正确（语法、类型、导入导出、构建），
 * 再在有明确测试文件或 tester 节点时补充行为验证。
 *
 * 验证分两层：
 * 1. 结构验证：tsc 编译、lint、基础装配正确性（客观，0/1）
 * 2. 行为验证：存在 tester 节点或显式测试文件时才运行
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { VerificationCriterion, VerificationRecord, type StructuredAcceptance } from "../graph";
import { ShipyardConfig } from "../config";
import { runAgent } from "../ai/llm";
import type { TaskStrategy, VerifierConfig } from "../strategies/base";
import { typescriptLibStrategy } from "../strategies";

function getMonorepoRoot(): string {
  return path.resolve(__dirname, "../../../../");
}

function getNodeModuleBin(binName: string): string {
  const monorepoRoot = getMonorepoRoot();
  return path.join(monorepoRoot, "node_modules/.bin", binName);
}

function getTypeScriptBinScript(scriptRel: string): string {
  const monorepoRoot = getMonorepoRoot();
  return path.join(monorepoRoot, "node_modules", scriptRel);
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function buildTscCommand(files: string[], hasTsx: boolean): string {
  const tscScript = getTypeScriptBinScript("typescript/bin/tsc");
  const jsxFlags = hasTsx ? "--jsx react-jsx --allowImportingTsExtensions" : "";
  const quotedFiles = files.map((f) => quote(f)).join(" ");
  return `node ${quote(tscScript)} --noEmit --target ES2022 --moduleResolution bundler --esModuleInterop --skipLibCheck ${jsxFlags} ${quotedFiles}`;
}

const TS_COMPILE_EXTENSIONS = new Set([".ts", ".tsx", ".cts", ".mts"]);
const JS_SYNTAX_EXTENSIONS = new Set([".js", ".jsx", ".cjs", ".mjs"]);

// Config files that import build-tool packages (vite, webpack, tailwind, etc.) not present
// in session output directories — skip compile check to avoid false "module not found" failures.
const SKIP_COMPILE_FILENAMES = new Set([
  "vite.config.ts",
  "vite.config.js",
  "tailwind.config.ts",
  "tailwind.config.js",
  "postcss.config.ts",
  "postcss.config.js",
  "webpack.config.ts",
  "webpack.config.js",
]);

function getCompileBuckets(files: string[]): { tsFiles: string[]; jsFiles: string[]; skippedFiles: string[] } {
  const tsFiles: string[] = [];
  const jsFiles: string[] = [];
  const skippedFiles: string[] = [];

  for (const file of files) {
    if (SKIP_COMPILE_FILENAMES.has(path.basename(file))) {
      skippedFiles.push(file);
      continue;
    }
    const ext = path.extname(file).toLowerCase();
    if (TS_COMPILE_EXTENSIONS.has(ext)) {
      tsFiles.push(file);
    } else if (JS_SYNTAX_EXTENSIONS.has(ext)) {
      jsFiles.push(file);
    } else {
      skippedFiles.push(file);
    }
  }

  return { tsFiles, jsFiles, skippedFiles };
}

// ─────────────────────────────────────────
// 层 1：确定性验证
// ─────────────────────────────────────────

export function runCompileCheck(files: string[], workDir: string): VerificationRecord {
  const start = Date.now();
  const timestamp = new Date().toISOString();

  if (files.length === 0) {
    return { type: "compile", passed: true, output: "No files to compile; skipped compile check", durationMs: 0, timestamp };
  }

  const { tsFiles, jsFiles, skippedFiles } = getCompileBuckets(files);
  const notes: string[] = [];

  try {
    if (tsFiles.length > 0) {
      const hasTsx = tsFiles.some((f) => f.endsWith(".tsx"));
      const cmd = buildTscCommand(tsFiles, hasTsx);
      execSync(cmd, { cwd: workDir, encoding: "utf-8", timeout: 30_000, stdio: ["pipe", "pipe", "pipe"] });
      notes.push(`${tsFiles.length} TS/TSX file(s) compiled`);
    }

    for (const file of jsFiles) {
      execSync(`node --check ${quote(file)}`, { cwd: workDir, encoding: "utf-8", timeout: 30_000, stdio: ["pipe", "pipe", "pipe"] });
    }
    if (jsFiles.length > 0) {
      notes.push(`${jsFiles.length} JS file(s) syntax-checked`);
    }

    if (skippedFiles.length > 0) {
      notes.push(`${skippedFiles.length} asset file(s) skipped (${skippedFiles.map((f) => path.extname(f) || "(no ext)").join(", ")})`);
    }

    if (notes.length === 0) {
      notes.push("No TypeScript/JavaScript files to compile; skipped asset-only compile check");
    }

    return { type: "compile", passed: true, output: notes.join("; "), durationMs: Date.now() - start, timestamp };
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
      "input": "create({ patientId: 'p1', measuredAt: '2024-01-01', glucoseValue: 5.5, unit: 'mmol/L' })",
      "expectedOutput": "{\\"id\\":\\"...\\",\\"patientId\\":\\"p1\\"}",
      "expectError": null
    }
  }
]

hardness:
- "hard": must pass — objective correctness (returns exact value, throws specific error)
- "soft": best-effort — subjective or approximate (output contains string, result is truthy)

CRITICAL rules for testCase.input — you MUST use one of these two formats:

Format A — Simple call expression (PREFERRED for exported functions/classes):
  "create({ patientId: 'p1', glucoseValue: 5.5, unit: 'mmol/L' })"
  The test runner will prefix this with the module import, producing: mod.create(...).
  - Start with the exported function/method/constructor name
  - Use ONLY simple literal values (strings, numbers, booleans, plain objects/arrays)
  - NO variable declarations (no const/let/var), NO IIFEs, NO inline async

Format B — Standalone expression (use ONLY when setup is unavoidable):
  "new GlucoseRecordRepository().create({ patientId: 'p1', glucoseValue: 5.5, unit: 'mmol/L' })"
  The test runner will execute this expression directly without any prefix.
  - Must be a single self-contained expression, NOT a block or script
  - Still no const/let/var, no async/await keywords (the runner handles async)

NEVER generate these:
  - IIFEs: (async () => { ... })()  — WRONG
  - Variable declarations: const x = ... — WRONG
  - Multi-statement blocks           — WRONG

Rules:
- SCAN the implementation code for exported function/class names — use EXACT names
- Extract ONLY behaviors explicitly stated in the spec
- Generate 1-3 behavior criteria — quality over quantity
- If spec is purely about types/interfaces with no runtime behavior, return []
- expectedOutput: a substring to match in the stringified result, or null to just check no-throw
`.trim();

export async function extractVerificationCriteria(
  specFragment: string,
  config: ShipyardConfig,
  outputFiles?: string[]
): Promise<VerificationCriterion[]> {
  // 把实际实现代码传给 LLM，让它用正确的函数名生成 testCase
  const codeContext = outputFiles
    ?.filter((f) => fs.existsSync(f))
    .map((f) => {
      const content = fs.readFileSync(f, "utf-8").slice(0, 6000);
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

  // ── 安全筛查：黑名单，只拦截真正危险的模式 ──
  const DANGEROUS_PATTERNS = [
    [/\brequire\s*\(/, "require()"],
    [/\bimport\s*\(/, "dynamic import()"],
    [/\bprocess\.exit\b/, "process.exit"],
    [/\bchild_process\b/, "child_process"],
    [/\beval\s*\(/, "eval()"],
    [/\bFunction\s*\(/, "new Function()"],
  ] as const;

  for (const [pattern, label] of DANGEROUS_PATTERNS) {
    if (pattern.test(tc.input)) {
      return {
        type: "test", passed: false,
        output: `Unsafe testCase.input rejected (${label} detected): ${tc.input.slice(0, 150)}`,
        durationMs: 0, timestamp: new Date().toISOString(),
      };
    }
  }

  // ── 为每一个真实存在且无重复的输出文件生成命名导入 ──
  // key=alias, value={ filePath, rel, exports: string[] }
  interface ModuleInfo { file: string; rel: string; exports: string[] }
  const modules: Map<string, ModuleInfo> = new Map();

  for (const f of outputFiles) {
    if (!fs.existsSync(f)) continue;
    const alias = `__m${modules.size}`;
    if ([...modules.values()].some((m) => m.file === f)) continue; // 去重
    const rel = path.relative(workDir, f).replace(/\\/g, "/").replace(/\.ts$/, "");

    const content = fs.readFileSync(f, "utf-8");
    const exports = new Set<string>();
    for (const re of [/export function (\w+)/g, /export const (\w+)/g, /export class (\w+)/g]) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) exports.add(m[1]);
    }
    const exportListRe = /export \{ ([\w\s,]+) \}/g;
    let m2: RegExpExecArray | null;
    while ((m2 = exportListRe.exec(content)) !== null) {
      m2[1].split(",").forEach((s) => exports.add(s.trim()));
    }
    modules.set(alias, { file: f, rel, exports: [...exports] });
  }

  // 生成 import 语句，如果有命名导出则用命名导入，否则用命名空间导入
  const importLines: string[] = [];
  const bareExportLines: string[] = [];

  for (const [alias, { rel, exports: names }] of modules) {
    if (names.length > 0) {
      importLines.push(`import { ${names.join(", ")} } from "./${rel}";`);
    } else {
      importLines.push(`import * as ${alias} from "./${rel}";`);
    }
  }

  // 如果 input 以 "exportedFunction(...)" 形式开头，且能找到匹配模块，拼接命名空间前缀
  // 否则直接用裸表达式（命名导入已将所有导出暴露到作用域）
  const funcName = tc.input.match(/^(\w+)\(/)?.[1] ?? "";
  const matchingModule = funcName
    ? [...modules.values()].find((m) => {
        const content = fs.readFileSync(m.file, "utf-8");
        return content.includes(`export function ${funcName}`) ||
               content.includes(`export const ${funcName}`) ||
               content.includes(`export { ${funcName}`);
      })
    : undefined;

  let callExpr: string;
  if (matchingModule) {
    // 找到该函数名所在的模块别名
    const alias = [...modules.entries()].find(([, v]) => v === matchingModule)?.[0] ?? "";
    callExpr = alias ? `${alias}.${tc.input}` : tc.input;
  } else {
    callExpr = tc.input;
  }

  // 将 expectedOutput 安全地嵌入为 JS 字面量
  const expectedLiteral = tc.expectedOutput != null
    ? JSON.stringify(tc.expectedOutput)
    : null;

  const testCode = `
${importLines.join("\n")}

async function runTest() {
  try {
    const result = await ${callExpr};
    ${tc.expectError
      ? `console.error("FAIL: expected error ${tc.expectError} but got result:", result); process.exit(1);`
      : expectedLiteral
        ? `const expected = ${expectedLiteral};
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
  let keepFile = false;

  try {
    fs.writeFileSync(tmpFile, testCode);

    // 预验证：tsc --noEmit，尽早暴露语法错误
    try {
      execSync(
        buildTscCommand([tmpFile], false),
        { cwd: workDir, encoding: "utf-8", timeout: 15_000, stdio: ["pipe", "pipe", "pipe"] }
      );
    } catch (e: unknown) {
      keepFile = true;
      const err = e as { stdout?: string; stderr?: string };
      const raw = [err.stdout, err.stderr].filter(Boolean).join("\n").trim();
      const tsErrors = raw.split("\n").filter((l) => /error TS\d+/.test(l)).join("\n");
      return {
        type: "test", passed: false,
        output: `Compile error in generated test (file kept: ${path.basename(tmpFile)}):\n${(tsErrors || raw).slice(0, 800)}`,
        durationMs: Date.now() - start, timestamp: new Date().toISOString(),
      };
    }

    // 运行
    const compilerOptions = JSON.stringify({ module: "commonjs", esModuleInterop: true }).replace(/"/g, '\\"');
    const output = execSync(
      `node ${quote(getNodeModuleBin("ts-node"))} --skipProject --compiler-options "${compilerOptions}" ${quote(tmpFile)}`,
      { cwd: workDir, encoding: "utf-8", timeout: 15_000, stdio: ["pipe", "pipe", "pipe"] }
    );
    return { type: "test", passed: true, output: output.trim().slice(0, 200), durationMs: Date.now() - start, timestamp };
  } catch (e: unknown) {
    keepFile = true;
    const err = e as { stdout?: string; stderr?: string };
    const raw = [err.stdout, err.stderr].filter(Boolean).join("\n").trim();
    const tsErrors = raw.split(/\n(?=\.|\w+\.ts)/).filter((l) => l.includes("error TS"));
    const output = (tsErrors.length > 0 ? tsErrors.join("\n") : raw).slice(0, 800);
    return {
      type: "test", passed: false,
      output: `Runtime error (file kept: ${path.basename(tmpFile)}):\n${output}`,
      durationMs: Date.now() - start, timestamp: new Date().toISOString(),
    };
  } finally {
    if (!keepFile && fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
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
      cmd = `${quote(getNodeModuleBin("biome"))} check --no-errors-on-unmatched ${relFiles}`;
    } else {
      cmd = `node ${quote(getTypeScriptBinScript("eslint/bin/eslint.js"))} --max-warnings=0 ${relFiles}`;
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

function extractRequiredExports(specFragment: string, acceptance?: StructuredAcceptance): string[] {
  if (acceptance?.exports?.length) return acceptance.exports;
  const match = specFragment.match(/exports?[:：]\s*([A-Za-z0-9_,\s]+)/i);
  if (!match) return [];
  return match[1].split(",").map((s) => s.trim()).filter(Boolean);
}

function collectExportsFromFiles(outputFiles: string[]): Set<string> {
  const exported = new Set<string>();
  for (const file of outputFiles) {
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, "utf-8");
    for (const re of [/export function (\w+)/g, /export const (\w+)/g, /export class (\w+)/g, /export interface (\w+)/g, /export type (\w+)/g]) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) exported.add(m[1]);
    }
  }
  return exported;
}

function buildStructuredAcceptanceRecords(
  outputFiles: string[],
  acceptance?: StructuredAcceptance,
  specFragment?: string
): VerificationRecord[] {
  const records: VerificationRecord[] = [];
  const timestamp = new Date().toISOString();
  const requiredExports = extractRequiredExports(specFragment ?? "", acceptance);
  if (requiredExports.length > 0) {
    const exported = collectExportsFromFiles(outputFiles);
    const missing = requiredExports.filter((name) => !exported.has(name));
    records.push({
      type: "spec_check",
      passed: missing.length === 0,
      output: missing.length === 0
        ? `Required exports present: ${requiredExports.join(", ")}`
        : `Missing required exports: ${missing.join(", ")}` ,
      durationMs: 0,
      timestamp,
    });
  }

  if (acceptance?.testsRequired) {
    const hasTestFile = outputFiles.some((f) => f.includes('.test.') || f.includes('.spec.'));
    records.push({
      type: "spec_check",
      passed: hasTestFile,
      output: hasTestFile
        ? "Structured acceptance: required test file present"
        : "Structured acceptance requires a colocated test/spec file",
      durationMs: 0,
      timestamp,
    });
  }

  if (acceptance?.requiredFiles?.length) {
    const existing = new Set(outputFiles.map((f) => path.basename(f)));
    const missingFiles = acceptance.requiredFiles.filter((name) => !existing.has(path.basename(name)));
    records.push({
      type: "spec_check",
      passed: missingFiles.length === 0,
      output: missingFiles.length === 0
        ? `Required files present: ${acceptance.requiredFiles.join(", ")}`
        : `Missing required files: ${missingFiles.join(", ")}` ,
      durationMs: 0,
      timestamp,
    });
  }

  if (acceptance?.forbiddenDependencies?.length) {
    const found: string[] = [];
    for (const file of outputFiles) {
      if (!fs.existsSync(file)) continue;
      const content = fs.readFileSync(file, "utf-8");
      for (const dep of acceptance.forbiddenDependencies) {
        const escaped = dep.replace(/[|\{}()[\]^$+?.]/g, "\\$&");
        const importRe = new RegExp(`from\\s+["']${escaped}["']|require\\(\\s*["']${escaped}["']\\s*\\)`);
        if (importRe.test(content)) found.push(dep);
      }
    }
    const uniqueFound = [...new Set(found)];
    records.push({
      type: "spec_check",
      passed: uniqueFound.length === 0,
      output: uniqueFound.length === 0
        ? "No forbidden dependencies detected"
        : `Forbidden dependencies detected: ${uniqueFound.join(", ")}` ,
      durationMs: 0,
      timestamp,
    });
  }

  return records;
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
  const monorepoRoot = getMonorepoRoot();
  const nmLink = path.join(outputDir, "node_modules");
  const vitestConfigPath = path.join(outputDir, "__shipyard_vitest.config.ts");
  const setupFilePath = path.join(outputDir, "__shipyard_vitest.setup.ts");

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

    // 2. 生成 vitest setup 文件（自动注入 jest-dom matchers，tester LLM 无需手动 import）
    fs.writeFileSync(setupFilePath, "import '@testing-library/jest-dom/vitest';\n");

    // 3. 在 output/ 生成 vitest.config.ts（无需 alias，node_modules 已在同目录）
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
      `    setupFiles: [${JSON.stringify(setupFilePath)}],`,
      "  },",
      "});",
    ].join("\n");
    fs.writeFileSync(vitestConfigPath, vitestConfig);

    // 3. 在 output/ 目录执行 vitest，它能正确解析 react 等依赖
    const start = Date.now();
    const timestamp = new Date().toISOString();
    const vitestBin = getNodeModuleBin("vitest");
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
    // 清理：只删 symlink 和临时 config/setup，不动 output/ 里的代码文件
    try { if (createdNmLink && fs.lstatSync(nmLink).isSymbolicLink()) fs.unlinkSync(nmLink); } catch { /**/ }
    try { if (fs.existsSync(vitestConfigPath)) fs.unlinkSync(vitestConfigPath); } catch { /**/ }
    try { if (fs.existsSync(setupFilePath)) fs.unlinkSync(setupFilePath); } catch { /**/ }
  }
}


export async function verifyNode(
  specFragment: string,
  outputFiles: string[],
  workDir: string,
  config: ShipyardConfig,
  nodeRole?: string,
  strategy?: TaskStrategy,
  acceptance?: StructuredAcceptance
): Promise<NodeVerificationResult> {
  const verifierConfig: VerifierConfig = (strategy ?? typescriptLibStrategy).verify();

  // tester 节点：走独立的测试执行环境，而非普通 compile check
  if (nodeRole === "tester") {
    return runTesterNodeVerification(outputFiles, workDir);
  }

  const records: VerificationRecord[] = [];

  // 1. 编译检查（由 VerifierConfig 控制 + acceptance 可显式关闭）
  const compileRequired = acceptance?.compileRequired ?? verifierConfig.compile;
  if (compileRequired) {
    const compileResult = runCompileCheck(outputFiles, workDir);
    records.push(compileResult);

    if (!compileResult.passed) {
      return {
        passed: false,
        records,
        summary: `Compile failed: ${compileResult.output.split("\n")[0]}`,
      };
    }
  } else {
    records.push({ type: "compile", passed: true, output: "Compile check skipped by structured acceptance", durationMs: 0, timestamp: new Date().toISOString() });
  }

  // 2. 检查文件是否有可执行的实现
  const hasImplementation = outputFiles.some((f) => {
    if (!fs.existsSync(f)) return false;
    const content = fs.readFileSync(f, "utf-8");
    return content.includes("export function") || content.includes("export const") || content.includes("export class");
  });

  // 纯类型文件或纯资产文件没有运行时行为，跳过行为验证
  if (!hasImplementation) {
    const allAssets = outputFiles.every((file) => {
      const ext = path.extname(file).toLowerCase();
      return !TS_COMPILE_EXTENSIONS.has(ext) && !JS_SYNTAX_EXTENSIONS.has(ext);
    });
    return { passed: true, records, summary: allAssets ? "Structural checks passed (asset-only file)" : "Compile passed (types-only file)" };
  }

  // 3. 行为测试仅在 strategy 显式开启时运行。
  //    第一轮实现默认只验证结构正确性；tester 节点仍走独立测试环境。
  const testFileRecords: VerificationRecord[] = [];
  const testFiles = !verifierConfig.behavior
    ? []
    : outputFiles.flatMap((f) => {
        const candidates: string[] = [];

        if (f.endsWith(".tsx")) {
          const base = f.replace(/\.tsx$/, "");
          candidates.push(`${base}.test.tsx`, `${base}.spec.tsx`, `${base}.test.ts`, `${base}.spec.ts`);
        } else if (f.endsWith(".ts")) {
          const base = f.replace(/\.ts$/, "");
          candidates.push(`${base}.test.ts`, `${base}.spec.ts`);
        } else if (f.endsWith(".js")) {
          const base = f.replace(/\.js$/, "");
          candidates.push(`${base}.test.js`, `${base}.spec.js`);
        }

        return candidates.filter((c) => fs.existsSync(c));
      });

  if (verifierConfig.behavior && testFiles.length === 0) {
    const timestamp = new Date().toISOString();
    records.push({
      type: "test",
      passed: true,
      output: "No explicit test file found; behavior verification deferred until a later tester/test pass.",
      durationMs: 0,
      timestamp,
    });
  }

  for (const testFile of testFiles) {
    const start = Date.now();
    const timestamp = new Date().toISOString();
    try {
      const compilerOptions = JSON.stringify({ module: "commonjs", esModuleInterop: true }).replace(/"/g, '\\"');
      const out = execSync(
        `node ${quote(getNodeModuleBin("ts-node"))} --skipProject --compiler-options "${compilerOptions}" ${quote(testFile)}`,
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

  const structuredAcceptanceRecords = buildStructuredAcceptanceRecords(outputFiles, acceptance, specFragment);
  records.push(...structuredAcceptanceRecords);

  // 6. Lint 检查（由 VerifierConfig 控制，软失败 — 不阻塞节点）
  if (verifierConfig.lint) {
    const lintResult = runLintCheck(outputFiles, workDir);
    if (lintResult) {
      records.push(lintResult);
      console.log(`    ${lintResult.passed ? "✅" : "⚠️ "} lint${!lintResult.passed ? ` (soft): ${lintResult.output.split("\n")[0]}` : ""}`);
    }
  }

  const testFileFailed = testFileRecords.some((record) => !record.passed);
  const structuredHardFailed = structuredAcceptanceRecords.some((record) => !record.passed);
  const passed = !testFileFailed && !structuredHardFailed;
  const failCount = records.filter((record) => !record.passed).length;
  const deferredBehavior = verifierConfig.behavior && testFiles.length === 0;

  return {
    passed,
    records,
    summary: passed
      ? deferredBehavior
        ? `Structural checks passed; behavior verification deferred`
        : failCount === 0
          ? `All ${records.length} check(s) passed`
          : `Hard checks passed; ${failCount} soft check(s) failed`
      : `${failCount}/${records.length} check(s) failed`,
  };
}
