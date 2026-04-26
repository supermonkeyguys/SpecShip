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
import { VerificationCriterion, VerificationRecord } from "./graph";
import { ShipyardConfig } from "./config";
import { runAgent } from "./llm";

// ─────────────────────────────────────────
// 层 1：确定性验证
// ─────────────────────────────────────────

export function runCompileCheck(files: string[], workDir: string): VerificationRecord {
  const start = Date.now();
  const timestamp = new Date().toISOString();

  if (files.length === 0) {
    return { type: "compile", passed: false, output: "No files to compile", durationMs: 0, timestamp };
  }

  try {
    const cmd = `npx tsc --noEmit --target ES2022 --moduleResolution node --esModuleInterop --skipLibCheck ${files.join(" ")}`;
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
You are a test specification extractor.

Given a spec fragment, extract concrete, executable verification criteria.

Output ONLY a JSON array:
[
  {
    "id": "vc-1",
    "description": "human readable description",
    "type": "compile | test | behavior | lint",
    "testCase": {
      "input": "login('a@b.com', 'wrongpass')",
      "expectedOutput": null,
      "expectError": "INVALID_CREDENTIALS"
    }
  }
]

Rules:
- Extract ONLY what is explicitly stated in the spec
- Do not invent requirements not in the spec
- behavior type: must have a concrete testCase with input/output
- compile type: no testCase needed
- Keep testCase.input as a valid TypeScript expression
- If spec says "returns X", create a behavior criterion
- If spec says "throws Y" or "错误", create a behavior criterion with expectError
- Maximum 5 criteria per spec fragment
`.trim();

const BEHAVIOR_SEMANTIC_REGEX = /(returns?|throws?|errors?|success|failure|返回|抛错|抛出|错误|成功|失败)/i;

function hasBehaviorSemantics(specFragment: string): boolean {
  return BEHAVIOR_SEMANTIC_REGEX.test(specFragment);
}

export async function extractVerificationCriteria(
  specFragment: string,
  config: ShipyardConfig
): Promise<VerificationCriterion[]> {
  const { finalText: raw } = await runAgent(
    SPEC_EXTRACTOR_PROMPT,
    `Extract verification criteria from this spec:\n\n${specFragment}`,
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
    const output = execSync(
      `npx ts-node --skipProject --compiler-options '{"module":"commonjs","esModuleInterop":true}' ${tmpFile}`,
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
// 完整验证流程：对一个节点跑所有验证
// ─────────────────────────────────────────

export interface NodeVerificationResult {
  passed: boolean;
  records: VerificationRecord[];
  summary: string;
}

export async function verifyNode(
  specFragment: string,
  outputFiles: string[],
  workDir: string,
  config: ShipyardConfig
): Promise<NodeVerificationResult> {
  const records: VerificationRecord[] = [];

  // 1. 编译检查（必须）
  const compileResult = runCompileCheck(outputFiles, workDir);
  records.push(compileResult);

  if (!compileResult.passed) {
    return {
      passed: false,
      records,
      summary: `Compile failed: ${compileResult.output.split("\n")[0]}`,
    };
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

  // 3. 从 spec 提取行为验证标准
  const criteria = await extractVerificationCriteria(specFragment, config);
  const behaviorCriteria = criteria.filter((c) => c.type === "behavior");

  // 含行为语义但无法提取任何行为验证标准时，视为验证失败，走重试链
  if (hasBehaviorSemantics(specFragment) && behaviorCriteria.length === 0) {
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

  // 4. 运行行为验证
  for (const criterion of behaviorCriteria) {
    const result = runBehaviorVerification(criterion, outputFiles, workDir);
    records.push(result);
    console.log(`    ${result.passed ? "✅" : "❌"} ${criterion.description}`);
  }

  const allPassed = records.every((r) => r.passed);
  const failCount = records.filter((r) => !r.passed).length;

  return {
    passed: allPassed,
    records,
    summary: allPassed
      ? `All ${records.length} check(s) passed`
      : `${failCount}/${records.length} check(s) failed`,
  };
}
