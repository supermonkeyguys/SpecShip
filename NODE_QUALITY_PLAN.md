# 节点质量优化技术方案

> 目标：减少节点 retry 次数，提升首次执行成功率

---

## 背景与问题分析

### 当前 retry 触发的三类原因

| 类型 | 触发场景 | 根本原因 |
|------|---------|---------|
| `fatal` | 执行崩溃、工具调用异常 | 环境/LLM 偶发错误，难以消除 |
| `verify` | 编译失败、测试不通过 | 依赖文件被截断、import 路径错误、代码不完整 |
| `review` | reviewer 判 passed=false | acceptanceCriteria 不准确，reviewer 用全局视角评判局部文件 |

### 核心矛盾

```
Planner 在规划阶段写 acceptanceCriteria
但依赖节点的代码还没写出来
→ acceptanceCriteria 只能"猜测"，猜错就导致 review 失败
```

---

## 已完成的修复（当前进度）

### ✅ 1. GraphNode 结构重构

**文件**: `packages/core/src/graph/graph.ts`

新增节点三要素字段，使每个节点自包含：

```ts
nodeRole: string;           // 执行者身份：types | implementer | tester | reviewer | integrator
task: string;               // 要做什么（具体函数/接口/逻辑描述）
acceptanceCriteria: string; // 做到什么标准（仅针对本文件，不跨节点）
skills: string[];           // 可插拔规范（预留：ts-strict、rest-naming 等）
lastErrorKind?: "fatal" | "verify" | "review"; // 上次失败类型
```

### ✅ 2. Reviewer prompt 修正

**文件**: `packages/core/src/ai/prompts.ts`

- Reviewer 只对照 `acceptanceCriteria` 验收，禁止跨节点评判
- 明确：passed=true 只要本文件满足标准，即使整个项目不完整

### ✅ 3. Review 上下文修复

**文件**: `packages/core/src/orchestrator/review.ts`

- 文件读取上限 2000 → 6000 字节，防止代码截断导致误判
- 旧 session 字段缺失时的 fallback：生成有约束力的兜底 acceptanceCriteria
  ```
  "SCOPE: Review ONLY this file. Check: (1) compiles, (2) implements what the title describes.
  Do NOT require other files or a complete application."
  ```

### ✅ 4. Retry 时保留上次代码

**文件**: `packages/core/src/orchestrator/node-executor.ts`

- `verify`/`review` 失败时**不删除文件**，LLM retry 时能看到上次写的代码 + 具体错误
- 只有 `fatal` 错误才删文件重写
- Implementer prompt 里明确标注错误类型：`⚠️ PREVIOUS ATTEMPT FAILED (reason: verify/review/fatal)`

### ✅ 5. maxRetries 调整

**文件**: `packages/core/src/config.ts`

- 默认 retry 次数：2 → **5**

### ✅ Planner fallback acceptanceCriteria 改进

**文件**: `packages/core/src/orchestrator/planner.ts`

```ts
// 旧：模糊
`${step.title} is correctly implemented in ${step.outputFile}.`

// 新：有约束
`SCOPE: Review ONLY ${step.outputFile}. Check: (1) compiles, (2) implements "${step.title}".
Do NOT require other files or a complete application.`
```

---

## 待实现：Level 1 方案

> 目标：在不引入 pre-executor 的前提下，通过提升 Planner 输出质量 + 执行前规则生成 acceptanceCriteria 来降低 retry

### L1-1. 优化 Planner prompt，要求 task 写到函数/接口级别

**文件**: `packages/core/src/ai/prompts.ts`

当前 task 示例（过于粗粒度）：
```json
"task": "实现用户服务层"
```

目标（函数签名级别）：
```json
"task": "实现 UserService 类，包含：createUser(data: CreateUserDto): Promise<User>、getUserById(id: string): Promise<User | null>。从 output/types.ts 导入 User 和 CreateUserDto。错误时抛出 ServiceError。"
```

**改动**：更新 `GRAPH_PLANNER_PROMPT` 中 task 字段的说明和示例，要求：
- 明确列出要实现的函数/类/接口名称
- 指定 import 来源（从哪个文件导入什么）
- 指定错误处理方式

### L1-2. 执行前从依赖文件规则生成 acceptanceCriteria

**文件**: `packages/core/src/orchestrator/node-executor.ts`（新增函数）

在节点执行前，读取 `dependsOn` 节点的输出文件，提取导出符号，自动补充/覆盖 acceptanceCriteria：

```ts
function buildAcceptanceCriteriaFromDeps(
  node: GraphNode,
  graph: ExecutionGraph,
  workDir: string
): string {
  // 如果节点已有精确的 acceptanceCriteria（Planner 生成的），直接用
  if (node.acceptanceCriteria && isAccurateCriteria(node.acceptanceCriteria)) {
    return node.acceptanceCriteria;
  }

  // 从依赖文件提取实际导出符号
  const exports = extractExportsFromDeps(node, graph, workDir);
  if (exports.length === 0) return node.acceptanceCriteria;

  return [
    node.acceptanceCriteria,
    `Must correctly import and use these symbols from dependencies: ${exports.join(", ")}.`,
    `Do NOT redefine types already defined in dependency files.`,
  ].join("\n");
}
```

**规则提取逻辑**（不用 LLM，纯静态分析）：
- 扫描 `export const/function/class/interface/type` 语句
- 提取符号名，追加到 acceptanceCriteria

---

## 未来：Level 2 方案（按需，节点数 > 20 时考虑）

### Pre-executor

在节点执行前增加一个轻量 LLM 调用，读取依赖文件的实际内容，动态补全 task 和 acceptanceCriteria：

```
Planner → 粗 task（结构正确）
    ↓
pre-executor（读依赖文件 + 轻量 LLM prompt）
    → 精确 task（含真实函数名、import 路径）
    → 精确 acceptanceCriteria（基于真实代码，不是猜测）
    ↓
Implementer → Reviewer
```

**触发条件**：
- 节点有 `dependsOn`（无依赖节点不需要，Planner 的 task 已经够用）
- 节点数 > 20（小项目 Planner 质量够，不值得多一次 LLM 调用）

**不引入 pre-executor 的理由（当前阶段）**：
- 改动涉及调度器核心逻辑，风险大
- 当前场景中小项目居多，Level 1 够用
- Level 1 做好后能客观评估是否真正需要 pre-executor

---

## 执行顺序

```
[已完成] ✅ GraphNode 结构重构（nodeRole/task/acceptanceCriteria/skills/lastErrorKind）
[已完成] ✅ Reviewer prompt 修正（只对照 acceptanceCriteria）
[已完成] ✅ Review 上下文修复（6000字节 + fallback）
[已完成] ✅ Retry 保留上次代码（fatal 才删文件）
[已完成] ✅ maxRetries 5
[已完成] ✅ Planner fallback acceptanceCriteria 改进

[已完成] ✅ L1-1: 优化 Planner prompt（task 写到函数/接口签名级别，含 import 来源）
[已完成] ✅ L1-2: 执行前+review前规则生成 acceptanceCriteria（从依赖文件静态提取导出符号，零 LLM 开销）

[未来]   🔮 Level 2: pre-executor（节点数 > 20 时引入）
```

---

## 预期效果

| 问题 | 修复前 | 修复后 |
|------|--------|--------|
| review 用全局视角评判局部文件 | 频繁 review 失败 | acceptanceCriteria 限定范围 |
| retry 看不到上次代码 | LLM 盲改 | 看到代码 + 错误，针对性修复 |
| 依赖文件被截断 | import 错误 → verify 失败 | 6000 字节 + 规则提取符号 |
| Planner task 过于粗粒度 | Implementer 自由发挥 | task 到函数签名级别 |
| retry 次数不够 | 2次就放弃 | 5次 |
