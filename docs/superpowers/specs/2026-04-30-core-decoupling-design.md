# Core 解耦重构设计文档

**日期:** 2026-04-30  
**状态:** 已完成（2026-04-30）  
**范围:** `packages/core`

---

## 背景

`packages/core` 当前的主要问题不是“功能缺失”，而是核心概念边界不够清晰，导致后续 agent 和工程师在理解、修改、验证时成本偏高。

本轮重构不追求一次性重写，而是采用**渐进式收口**：

1. 先把 `shipyard.ts` 中最稳定、最容易分离的职责抽出来
2. 保持外部 API 和回归测试基本不变
3. 为后续更大的状态/依赖/checkpoint 重构建立边界

---

## 当前识别出的核心问题

### 1. `shipyard.ts` 职责过载

当前同时承担：
- spec clarification
- planning / graph build
- node execution
- code review
- checkpoint coordination
- main run loop orchestration

这会导致任何局部修改都需要理解大段控制流。

### 2. 运行时契约分散

与 orchestration 强相关的类型和注入契约分散在 `shipyard.ts` 内部：
- `AgentRunner`
- `NodeVerifier`
- `ClarificationQuestion`
- `ClarificationResult`
- `CheckpointHandler`

这些类型本质上是**跨模块运行时契约**，不应埋在单一 orchestrator 文件中。

### 3. output path / model config / review 逻辑边界模糊

- output path 校验同时被 planning 和 execute 使用
- LLM client config 组装同时被 planning / execution / review 使用
- review 是独立步骤，但目前夹在 `shipyard.ts` 内

这些都适合先抽成清晰的边界模块。

---

## 目标

### 本轮目标（Phase 1）

在**不改变核心行为**的前提下，完成以下结构化拆分：

1. 新建 `runtime-types.ts`
   - 承载 orchestration 共享契约类型

2. 新建 `llm-config.ts`
   - 承载从 `ShipyardConfig` 派生 `LLMClientConfig` 的逻辑

3. 新建 `output-policy.ts`
   - 承载 outputDir 路径边界校验逻辑

4. 新建 `planner.ts`
   - 承载 `clarifySpec()` 和 `buildGraph()`

5. 新建 `review.ts`
   - 承载 `runCodeReview()`

6. 收缩 `shipyard.ts`
   - 保留 `executeNode()`、`run()` 和 checkpoint summary 相关 orchestration
   - 通过 re-export 保持 API 兼容
   - 移除动态 `require("./project")`

---

## 非目标

本轮**不做**：

- 不统一 node/graph/session 状态机
- 不改变 `dependsOn` 的双语义问题
- 不节点化 verify/review/integrate
- 不重写 `llm.ts` 与 `verify.ts`
- 不改变现有 prompt schema

这些属于后续阶段。

---

## 设计方案

## 1. 模块边界

### `packages/core/src/runtime-types.ts`

职责：统一导出 orchestration 共享运行时契约。

包含：
- `AgentRunner`
- `NodeVerifier`
- `ClarificationQuestion`
- `ClarificationResult`
- `CheckpointHandler`

### `packages/core/src/llm-config.ts`

职责：单点定义 `ShipyardConfig -> LLMClientConfig` 的映射。

### `packages/core/src/output-policy.ts`

职责：单点定义 output 文件路径必须位于 `outputDir` 下的约束。

### `packages/core/src/planner.ts`

职责：planning 前半段。

包含：
- `clarifySpec()`
- `buildGraph()`
- planning 相关内部校验逻辑（重复 step id / 非法依赖 / cycle）

### `packages/core/src/review.ts`

职责：review 步骤。

包含：
- `runCodeReview()`

### `packages/core/src/shipyard.ts`

Phase 1 收口后的职责：
- `executeNode()`
- `run()`
- checkpoint summary 生成
- orchestration 级协调
- 对外 re-export planner/review/runtime types

---

## 2. API 兼容策略

为避免影响现有调用方：

- `packages/core/src/shipyard.ts` 继续导出：
  - `buildGraph`
  - `clarifySpec`
  - `runCodeReview`
  - `AgentRunner`
  - `NodeVerifier`
  - `CheckpointHandler`
  - `ClarificationQuestion`
  - `ClarificationResult`

- `@shipyard/core` 根导出不要求调用方立即迁移
- `packages/orchestrator-temporal` 与现有 regression tests 应无需改业务语义

---

## 3. Phase 2 / 3 展望（本轮不做）

### Phase 2
- checkpoint runtime 独立模块化
- graph stats 统一计算入口
- verify/review pipeline 显式化

### Phase 3
- `dependsOn` 改为单语义或 typed union
- graph / session / checkpoint 状态统一迁移层
- `llm.ts` 拆 transport / tool registry / runtime loop

---

## 验收标准

本轮完成后，应满足：

1. `shipyard.ts` 不再定义 planning / clarification / review 主逻辑
2. `AgentRunner` / `NodeVerifier` 等共享契约不再埋在 `shipyard.ts`
3. output path 规则和 LLM config 组装不再散落在 orchestrator 内部
4. `packages/orchestrator-temporal` 仍可通过 `@shipyard/core` 调用原有 API
5. root `pnpm typecheck` 和现有 regression tests 通过

---

## 本次执行范围

本次提交将执行 **Phase 1**。

---

## Phase 2 已落地

本轮继续完成了两项收口：

1. **graph stats 单点化**
   - 新增 `graph-stats.ts`
   - 删除 `checkpoint.ts` 中重复的统计逻辑
   - 新增 `replaceGraphNodes()`，让直接替换 nodes 的路径也自动重算 stats

2. **checkpoint runtime 收口**
   - 新增 `checkpoint-runtime.ts`
   - 抽出 checkpoint summary 文件写入、checkpoint evidence 构造、pause/resume 相关图更新逻辑
   - `shipyard.ts` 不再内嵌 checkpoint summary 构造细节

---

## Phase 3A 已落地

本轮继续把 node execution 从 orchestrator 中分离：

1. 新增 `node-executor.ts`
   - 收口重试清理、依赖上下文拼装、实现 prompt 构造、写路径校验、evidence 收集

2. `shipyard.ts` 进一步收缩
   - 不再包含 `executeNode()` 的具体实现
   - 继续保留 `run()` 主调度循环与兼容 re-export

这让 `shipyard.ts` 更接近纯 orchestrator，也为后续把 verify/retry/post-node handling 继续抽离做准备。

---

## Phase 3B 已落地

本轮继续把 `run()` 中节点完成后的大分支从 orchestrator 主循环中抽离：

1. 新增 `post-node-handler.ts`
   - 收口 fatal execution error 重试逻辑
   - 收口 verify / review / success / fail 的后处理逻辑

2. `shipyard.ts` 进一步收缩
   - 主循环更接近「dispatch ready nodes → wait result → 委托 handler → checkpoint」

这一步让 orchestrator 的结构更清晰，也为后续进一步抽离 checkpoint dispatch / scheduler policies 做准备。

---

## Final semantic alignment 已落地

本轮完成了计划中的最后两项高优先级语义收口：

1. **dependsOn 单语义化**
   - `dependsOn` 明确只表示上游 step/node ID
   - `isDependencySatisfied()` 不再接受文件路径作为依赖
   - planner prompt / 注释 /实现保持一致

2. **节点/状态模型收口**
   - `NodeType` 收缩为真实运行时存在的 `implement | checkpoint`
   - 新增 `state.ts`，集中定义 `GraphStatus` / `SessionStatus` 以及 graph→session 的映射
   - server 路由不再手写 graph.status 到 session.status 的条件分支

至此，这份 core 解耦计划定义的结构边界与高优先级语义问题均已收口。
