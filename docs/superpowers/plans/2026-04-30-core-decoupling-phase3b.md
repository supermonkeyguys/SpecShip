# Core Decoupling Phase 3B Plan

> Goal: 把 `run()` 中“节点完成后的处理逻辑”从 `shipyard.ts` 抽到独立模块，让 orchestrator 主循环更接近 dispatch / await / delegate 的结构。

**状态:** 已执行（2026-04-30）

---

## File Map

| 文件 | 动作 |
|------|------|
| `packages/core/src/post-node-handler.ts` | 新增节点结果后处理模块 |
| `packages/core/src/shipyard.ts` | 改为委托 `handleCompletedNodeResult()` |
| `packages/core/src/index.ts` | 暴露 `post-node-handler.ts` |
| `docs/superpowers/plans/2026-04-30-core-decoupling-phase3b.md` | 新增计划记录 |
| `docs/superpowers/specs/2026-04-30-core-decoupling-design.md` | 更新 Phase 3B 落地说明 |

---

## Tasks

- [x] 新增 `post-node-handler.ts`
- [x] 抽出 fatal error retry 分支
- [x] 抽出 verify / review / success / fail 的后处理分支
- [x] `shipyard.ts` 改为在节点完成后委托 handler
- [x] 更新根导出
- [x] 执行 typecheck
- [x] 执行 regression tests

---

## Acceptance

- [x] `run()` 不再直接内嵌大段节点结果分支处理
- [x] orchestrator 主循环更接近调度器角色
- [x] 编译与回归测试通过
