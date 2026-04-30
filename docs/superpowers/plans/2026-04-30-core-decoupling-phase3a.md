# Core Decoupling Phase 3A Plan

> Goal: 把 `executeNode()` 的实现细节从 `shipyard.ts` 抽到 `node-executor.ts`，让 orchestrator 进一步收缩，只保留主调度循环和生命周期协调。

**状态:** 已执行（2026-04-30）

---

## File Map

| 文件 | 动作 |
|------|------|
| `packages/core/src/node-executor.ts` | 新增 node execution 模块 |
| `packages/core/src/shipyard.ts` | 改为复用 `node-executor.ts` |
| `packages/core/src/index.ts` | 暴露 `node-executor.ts` |
| `docs/superpowers/plans/2026-04-30-core-decoupling-phase3a.md` | 新增计划记录 |
| `docs/superpowers/specs/2026-04-30-core-decoupling-design.md` | 更新 Phase 3A 落地说明 |

---

## Tasks

- [x] 新增 `node-executor.ts`
- [x] 将输出清理、依赖上下文构造、prompt 组装、写路径校验、evidence 收集迁出 `shipyard.ts`
- [x] `shipyard.ts` 改为 re-export `executeNode`
- [x] 更新根导出
- [x] 执行 typecheck
- [x] 执行 regression tests

---

## Acceptance

- [x] `shipyard.ts` 不再包含 `executeNode()` 的细节实现
- [x] 调用方 API 不变
- [x] 编译与回归测试通过
