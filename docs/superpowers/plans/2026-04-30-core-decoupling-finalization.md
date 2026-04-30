# Core Decoupling Finalization Plan

> Goal: 完成 core 解耦计划最后的语义收口，使结构边界和高优先级领域语义都进入一致状态。

**状态:** 已执行并完成（2026-04-30）

---

## File Map

| 文件 | 动作 |
|------|------|
| `packages/core/src/state.ts` | 新增 graph/session 状态类型与映射 |
| `packages/core/src/graph.ts` | dependsOn 单语义化，NodeType 收缩为真实运行时类型 |
| `packages/core/src/project.ts` | SessionStatus 改为复用 `state.ts` |
| `packages/core/src/planner.ts` | planner role 收口到 `implementation | checkpoint` |
| `packages/core/src/prompts.ts` | 更新 prompt，移除文件路径 dependsOn 暗示 |
| `packages/shared/src/types.ts` | 前后端共享 nodeType 收口 |
| `apps/server/src/state.ts` | server wrapper export |
| `apps/server/src/routes/run.ts` | 使用 graph→session 状态映射 |
| `apps/server/src/routes/resume.ts` | 使用 graph→session 状态映射 |
| `apps/web/src/features/canvas/Canvas.tsx` | 更新 nodeType label 映射 |
| `docs/superpowers/specs/2026-04-30-core-decoupling-design.md` | 标记计划完成 |

---

## Tasks

- [x] 新增 `state.ts`，集中 graph/session 状态类型与映射
- [x] `dependsOn` 单语义化为 step/node ID
- [x] `NodeType` 收缩为真实运行时类型
- [x] server 路由改为复用 graph→session 映射
- [x] 前后端共享 nodeType 对齐
- [x] 更新 spec 为完成状态
- [x] 执行 root typecheck
- [x] 执行 regression tests
- [x] 执行 web build 验证前端类型兼容

---

## Acceptance

- [x] graph/planner/executor 对 `dependsOn` 的语义一致
- [x] nodeType 不再承诺不存在的运行时节点类型
- [x] graph.status 到 session.status 的映射有单点定义
- [x] 计划完成并验证通过
