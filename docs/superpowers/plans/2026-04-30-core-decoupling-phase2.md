# Core Decoupling Phase 2 Plan

> Goal: 在 Phase 1 基础上，继续把 `packages/core` 的 checkpoint/runtime 和 graph stats 收口成更清晰的模块边界，降低后续 agent 修改时的隐性耦合。

**状态:** 已执行（2026-04-30）

---

## File Map

| 文件 | 动作 |
|------|------|
| `packages/core/src/graph-stats.ts` | 新增 graph stats 单点计算模块 |
| `packages/core/src/checkpoint-runtime.ts` | 新增 checkpoint runtime 模块 |
| `packages/core/src/graph.ts` | 改为复用 graph-stats，并暴露 `replaceGraphNodes()` |
| `packages/core/src/checkpoint.ts` | 删除重复 stats 计算逻辑，改用单点统计 |
| `packages/core/src/shipyard.ts` | 改为调用 checkpoint-runtime / `replaceGraphNodes()` |
| `packages/core/src/index.ts` | 暴露新增模块 |

---

## Tasks

- [x] 新增 `graph-stats.ts`，收口 `emptyStatusCount()` / `recalcGraphStats()`
- [x] 新增 `replaceGraphNodes()`，让手工节点变更也自动重算 stats
- [x] `checkpoint.ts` 删除重复 stats 逻辑
- [x] 新增 `checkpoint-runtime.ts`，收口 checkpoint summary / pause / resume 相关逻辑
- [x] `shipyard.ts` 改为复用 checkpoint runtime 与 `replaceGraphNodes()`
- [x] 更新根导出
- [x] 执行 typecheck
- [x] 执行 regression tests

---

## Acceptance

- [x] graph stats 只保留一个计算入口
- [x] checkpoint summary / pause 逻辑不再内嵌于 `shipyard.ts`
- [x] 直接替换节点 map 的地方尽量统一通过 `replaceGraphNodes()`
- [x] 编译与回归测试通过
