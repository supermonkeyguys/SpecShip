# Plan.md Flow — Design Spec

**Date:** 2026-05-13  
**Status:** Approved  
**Replaces:** PRD flow (`/api/prd`, `pendingPRD` state)

---

## 目标

将现有的 PRD → 执行两阶段流程升级为：

```
spec → clarify → plan.md（用户确认）→ 执行
```

plan.md 同时承担 PRD（"做什么"）和执行计划（"怎么做"）两个职责，是执行的 source of truth。

支持两类用户：
- **简单模式**：看目标 + 步骤摘要，一键确认，不接触技术细节
- **专家模式**：完整结构化 Markdown 编辑器，可改节点内容、调依赖、插入 checkpoint

---

## plan.md 格式规范

### 完整示例

```markdown
# 任务标题（max 60 chars）

## 目标
一段话：解决什么问题，成功标准是什么。

## 技术约束
- React + TypeScript
- 不引入新的状态管理库

## 假设
- 用户已登录，不需要处理 auth

---

## 步骤

### step: impl-types
- title: 定义类型
- role: types
- file: output/types.ts
- depends: []
- checkpoint: false
- task: |
    定义 User { id, name, email } 和 Post { id, title, content, authorId }，全部从 types.ts export。
- acceptance: |
    exports: [User, Post]
    compile: true

### step: impl-user-service
- title: 用户服务
- role: implementer
- file: output/userService.ts
- depends: [impl-types]
- checkpoint: false
- task: |
    实现 UserService 类，包含 createUser / getUserById。从 ./types import User。
- acceptance: |
    exports: [UserService]
    compile: true

### step: checkpoint-review-schema
- title: 确认数据结构
- role: checkpoint
- file: output/checkpoint-schema.md
- depends: [impl-types]
- checkpoint: true
- task: |
    请确认 User 和 Post 的字段设计符合预期，再继续执行后续步骤。
- acceptance: |
    human: true
```

### 字段语义

| 字段 | 类型 | 说明 |
|------|------|------|
| `### step: {id}` | heading | 节点 id，kebab-case，全局唯一 |
| `title` | string | 人类可读标题，展示在 Canvas |
| `role` | enum | `types \| implementer \| tester \| integrator \| checkpoint` |
| `file` | string | 输出文件路径，全局唯一；checkpoint 节点用 `.md` |
| `depends` | `[id, ...]` | 依赖的 step id 列表，空为 `[]` |
| `checkpoint` | bool | `true` 时节点类型为 checkpoint，暂停等待人工确认 |
| `task` | multiline string | Implementer LLM 收到的具体任务描述 |
| `acceptance` | multiline string | 验收条件，key: value 格式 |

### Header 区块

- `## 目标` — 写入 `graph.title` 和 session 元数据
- `## 技术约束` — 解析后拼接到每个节点 task 的开头，作为全局约束上下文
- `## 假设` — 记录到 session 元数据，不影响执行

---

## 架构和数据流

### 完整流程

```
前端 TaskCreation:
  spec
    → POST /api/clarify            歧义检测（已有，不变）
    → POST /api/plan               生成 plan.md（新增）
    → 用户审阅 plan.md
        简单模式: 目标 + 步骤标题列表，点"确认执行"
        专家模式: 完整 Markdown 编辑器，可编辑内容/depends/checkpoint
    → POST /api/run { spec: plan_md, mode: "plan" }
    → 执行
```

### 各层改动

#### `packages/core`（新增）

**`orchestrator/plan-generator.ts`**
```ts
export async function generatePlan(
  spec: string,
  config: ShipyardConfig,
  agentRunner?: AgentRunner
): Promise<string>  // 返回 plan.md 文本
```

**`orchestrator/plan-parser.ts`**
```ts
export interface PlanParseResult {
  ok: boolean;
  plan?: PlannerPlan;   // 复用现有 PlannerPlan 类型
  errors?: string[];    // 行级别错误信息
}

export function parsePlan(markdown: string): PlanParseResult
// 确定性解析，无 LLM 调用
// 复用现有 validatePlanData() 做语义校验
```

**`ai/prompts.ts`**
- 新增 `PLAN_GENERATOR_PROMPT`：生成结构化 plan.md 的 system prompt
- 保留 `GRAPH_PLANNER_PROMPT`（`mode: "spec"` 时仍使用）
- `PRD_GENERATOR_PROMPT` 标记 deprecated，不删除

#### `apps/server`（改动）

**新增 `routes/plan.ts`**
```
POST /api/plan
Body: { spec: string, llm?: LLMOverride }
Response: { ok: true, plan: string } | { ok: false, error: string }
```
调用 `generatePlan()`，失败时最多重试 4 次（复用 Planner 重试逻辑）。

**改动 `routes/run.ts`**
```ts
// 新增 mode 参数
POST /api/run { spec: string, mode?: "spec" | "plan", ... }

// mode = "plan": 跳过 buildGraph() 的 LLM 规划，直接 parsePlan()
// mode = "spec"（默认）: 现有行为不变
```

**持久化**
- plan.md 写入 `.shipyard/projects/{proj}/sessions/{sess}/plan.md`
- 作为该 session 的执行依据，供 resume / debug 查阅

**废弃 `routes/prd.ts`**
- `POST /api/prd` 返回 410 Gone，body: `{ deprecated: true, useInstead: "/api/plan" }`

#### `apps/web`（改动）

**`features/task-creation/useTaskCreationFlow.ts`**
- `generatePRD` 调用 → `generatePlan`
- stage `reviewing_prd` → `reviewing_plan`
- `pendingPRD` → `pendingPlan`（类型同步更新）

**新增 `features/task-creation/PlanEditor.tsx`**
- 简单模式：展示 `## 目标` 文本 + 步骤 title 列表（只读）+ 确认/放弃按钮
- 专家模式：Monaco 或 `<textarea>` Markdown 编辑器 + 模式切换 + 确认/放弃按钮
- 模式切换不丢失已编辑内容
- 确认前做客户端校验（调用 `/api/plan/validate` 或前端内联解析），报行级错误

**`domains/workspace/store.ts`**
- `pendingPRD` → `pendingPlan`，完全替换，无向后兼容

**`shared/api/planClient.ts`**（新增，替换 `prdClient.ts`）
```ts
export async function generatePlan(spec: string): Promise<string>
export async function validatePlan(plan: string): Promise<{ ok: boolean; errors: string[] }>
```

---

## 错误处理

### plan.md 解析失败（用户改坏格式）

- `parsePlan()` 返回 `{ ok: false, errors: string[] }`，不抛异常
- 前端在"确认执行"时先客户端校验，展示行级错误，阻止提交
- 服务端 `/api/run` 收到 `mode: "plan"` 时再做一次校验，失败返回 400 + errors
- **不** fallback 到 LLM 重新规划——用户明确编辑了就必须修到合法

### `generatePlan()` 失败

- 最多重试 4 次（指数退避，复用现有逻辑）
- 全部失败：前端展示错误，停在 `reviewing_plan` 阶段
- **不** 自动 fallback 到直接执行——不绕过用户确认控制点

### checkpoint 合法性

- 用户将 `checkpoint: false` 改为 `true`：解析时自动设节点 type 为 checkpoint
- 下游节点自动进入 `pending` 状态，等 checkpoint 完成后解锁
- 复用现有 `checkpoint-runtime.ts` 逻辑，无需新增机制

---

## 模式切换行为

| 操作 | 行为 |
|------|------|
| 简单 → 专家 | 展开完整 plan.md，内容不变 |
| 专家 → 简单 | 折叠技术细节，已编辑内容保留 |
| 确认执行 | 两种模式均提交当前 plan.md 内容（简单模式提交未编辑的原始生成内容） |
| 放弃 | 回到 drafting 阶段，plan.md 丢弃 |

---

## 不在范围内

- plan.md 的实时协作编辑
- plan.md 版本历史 / diff 对比
- 专家模式的可视化 DAG 编辑（仍用 Markdown）
- `mode: "spec"` 的现有流程任何改动
