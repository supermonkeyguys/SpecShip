# Core Decoupling Phase 1 Plan

> Goal: 在不改变行为的前提下，把 `packages/core/src/shipyard.ts` 中最稳定、最容易分离的职责抽离出来，建立更清晰的 orchestrator 边界。

**状态:** 已执行（2026-04-30）

---

## File Map

| 文件 | 动作 |
|------|------|
| `docs/superpowers/specs/2026-04-30-core-decoupling-design.md` | 新增设计文档 |
| `packages/core/src/runtime-types.ts` | 新增 orchestration 共享契约 |
| `packages/core/src/llm-config.ts` | 新增 LLM config factory |
| `packages/core/src/output-policy.ts` | 新增 outputDir 路径规则 |
| `packages/core/src/planner.ts` | 新增 clarify/buildGraph |
| `packages/core/src/review.ts` | 新增 runCodeReview |
| `packages/core/src/shipyard.ts` | 收缩为 execute/run orchestration |
| `packages/core/src/index.ts` | 保持 root exports 可用 |

---

## Tasks

- [x] 新建设计文档，明确 Phase 1 范围、非目标与验收标准
- [x] 提取 orchestration 共享契约到 `runtime-types.ts`
- [x] 提取 `makeLLMConfig()` 到 `llm-config.ts`
- [x] 提取 output path 校验到 `output-policy.ts`
- [x] 提取 `clarifySpec()` / `buildGraph()` 到 `planner.ts`
- [x] 提取 `runCodeReview()` 到 `review.ts`
- [x] 收缩 `shipyard.ts`，保留 execute/run/checkpoint 协调
- [x] 去掉 `shipyard.ts` 中的动态 `require("./project")`，改为显式 import
- [x] 执行 typecheck
- [x] 执行 regression tests

---

## Acceptance

- [x] `shipyard.ts` 不再定义 clarification / buildGraph / review 主逻辑
- [x] 现有 API 兼容（调用方无需立刻迁移）
- [x] 编译与回归测试通过
