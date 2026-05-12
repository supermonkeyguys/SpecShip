# packages/core Phase 1 实施设计

> 状态：执行前设计文档
> 最后更新：2026-05-11
> 关联文档：`docs/core-multi-model-workflow-plan.md`

---

## 1. Phase 1 目标

本阶段只做“让现有抽象真正进入 runtime”的工作，不引入 repo-edit mode，不重写 scheduler，不改前端协议。

目标：

1. 让 `nodeRole` 真正影响模型、prompt、工具与验证行为
2. 新增 `model-router`，统一决策每个节点使用哪个模型
3. 在 `buildGraph()` 中严格校验 strategy `allowedExtensions`
4. 让 `run_command` 的允许命令来自 strategy，而不是 `llm.ts` 硬编码白名单
5. 在 execution log / node evidence 中记录模型选择与路由原因

非目标：

- 不做 repo-edit mode
- 不做 acceptance schema 结构化改造
- 不做复杂的 LLM 辅助路由
- 不调整前端 UI

---

## 2. 设计原则

### 2.1 兼容优先

Phase 1 必须保证：

- 现有 `typescript-lib` 默认行为不被破坏
- 未显式提供新配置时，系统仍可用默认值运行
- Temporal 侧如果依赖 core 注入接口，不应被破坏

### 2.2 路由纯规则化

第一版 `model-router` 只做规则映射，不引入模型参与选模。

### 2.3 尽量少改 public API

优先在内部新增可选配置和工具上下文，而不是大面积修改外层调用方式。

---

## 3. 计划拆分

### Step 1. 配置层扩展 → verify: `config.ts` / `llm-config.ts` 编译通过

目标：

- 扩展 `ShipyardConfig.models`
- 保留旧字段兼容
- 为 clarifier / planner / implementer / reviewer / tester / integrator / utility 提供默认模型解析

涉及文件：

- `packages/core/src/config.ts`
- `packages/core/src/ai/llm-config.ts`

实施方式：

- `models` 从旧三字段扩展到新角色集合
- 保留 `planning / implementation / review` 作为兼容别名或 fallback 来源
- 新增读取函数，统一返回完整模型映射

---

### Step 2. 新增 model-router → verify: 单测/编译通过，executor/review/planner 可调用

目标：

新增统一路由模块，根据：

- 阶段（clarify / plan / execute / review）
- `nodeRole`
- `retryCount`

输出：

- `model`
- `reason`

涉及文件：

- 新增 `packages/core/src/orchestrator/model-router.ts`

路由规则（Phase 1 简化版）：

- clarify -> `clarifier`
- plan -> `planner`
- review -> `reviewer`
- execute:
  - `tester` -> `tester`
  - `integrator` -> `integrator`
  - `utility` -> `utility`
  - 其他 -> `implementer`
- 若 `retryCount >= 1` 且存在更强 fallback，则升级到 `planner` 或 `reviewer` 不变、executor 升 `integrator`

---

### Step 3. 新增 node-role-policy → verify: executor 按 role 切 prompt/tool/verify 策略

目标：

将 `nodeRole` 收口为真正可执行策略，不再散落在多个文件里 if/else。

涉及文件：

- 新增 `packages/core/src/orchestrator/node-role-policy.ts`
- 修改 `packages/core/src/orchestrator/node-executor.ts`
- 修改 `packages/core/src/verification/verify.ts`（尽量少）

输出信息：

- `systemPrompt`
- `tools`
- `verifyMode`（先保留现有逻辑，tester 特判）
- `roleLabel`

Phase 1 规则：

- `tester` -> tester prompt + tester tools
- `utility` -> implementer prompt（暂复用）+ 普通 tools
- `integrator` -> implementer prompt（暂复用）+ 普通 tools
- `types` / `implementer` -> implementer prompt

说明：

Phase 1 先把“路由落地”做完，不强行引入过多新 prompt。

---

### Step 4. allowedExtensions enforce → verify: 不允许的 outputFile 在 buildGraph 时失败

目标：

planner 生成的每个 step.outputFile，除了要在 outputDir 内，还必须属于 strategy 允许的扩展名。

涉及文件：

- `packages/core/src/orchestrator/planner.ts`

规则：

- 读取 `strategy.plan(config).allowedExtensions`
- checkpoint 节点如果没有 outputFile/或走 markdown summary，可单独允许 `.md`
- 对无扩展名文件直接失败（Phase 1 保守）

---

### Step 5. allowedCommands 真正接入 tool runtime → verify: 各 strategy 命令白名单生效

目标：

移除 `llm.ts` 中 `run_command` 的硬编码 allowlist，让其由 runtime 传入。

涉及文件：

- `packages/core/src/ai/llm.ts`
- `packages/core/src/orchestrator/node-executor.ts`
- `packages/core/src/strategies/*`

实施方式：

- 给 `runAgent()` 增加一个可选 `toolRuntimeContext`
- `executeTool()` 在执行 `run_command` 时读取 `allowedCommands`
- `node-executor` 通过 active strategy 注入允许命令
- planner/reviewer/clarifier 仍然 `withTools=false`，不受影响

注意：

- 仅调整 runtime allowlist，不扩大策略声明的能力范围
- 默认值保持与当前 `typescript-lib` 一致，避免破坏现有行为

---

### Step 6. 日志与 evidence 增强 → verify: execution.log 与 node evidence 能看到模型路由结果

目标：

让后续调试知道：

- 当前节点为什么选这个模型
- retry 后是否升级了模型

涉及文件：

- `packages/core/src/orchestrator/execution-logger.ts`
- `packages/core/src/graph/graph.ts`
- `packages/core/src/orchestrator/node-executor.ts`
- `packages/core/src/orchestrator/review.ts`
- `packages/core/src/orchestrator/planner.ts`

最小实现：

- 为 node evidence 增加 `modelRouteReason?: string`
- logger 的 `node_start` 或 `node_prompt` 增加 `selectedModel`、`routeReason`

---

## 4. 文件级改动清单

### 新增文件

```text
packages/core/src/orchestrator/model-router.ts
packages/core/src/orchestrator/node-role-policy.ts
```

### 修改文件

```text
packages/core/src/config.ts
packages/core/src/ai/llm-config.ts
packages/core/src/ai/llm.ts
packages/core/src/graph/graph.ts
packages/core/src/orchestrator/execution-logger.ts
packages/core/src/orchestrator/planner.ts
packages/core/src/orchestrator/node-executor.ts
packages/core/src/orchestrator/review.ts
packages/core/src/orchestrator/index.ts
```

---

## 5. 推荐实现顺序

1. **配置层**：`config.ts` / `llm-config.ts`
2. **router**：`model-router.ts`
3. **role policy**：`node-role-policy.ts`
4. **llm tool runtime**：`llm.ts`
5. **executor / review / planner 接入**
6. **logging / evidence 补充**
7. **typecheck / targeted tests**

---

## 6. 风险点

### 风险 A：旧环境变量兼容性

当前 repo 中已有：

- `MODEL_PLANNING`
- `MODEL_IMPLEMENTATION`
- `MODEL_REVIEW`

Phase 1 需要保证这些变量继续有效，否则会破坏现有部署。

### 风险 B：Strategy 与 Runtime 约束不一致

如果只改了 strategy 配置、不改 runtime 执行，会产生“看起来支持，实际执行失败”的假象。

### 风险 C：工具上下文改造会影响 AgentRunner 签名

`runAgent()` 的参数调整要尽量向后兼容，避免影响：

- core 测试
- Temporal activity 注入
- 外部替代 runner

建议：优先新增可选参数，而不是改必填参数顺序。

---

## 7. 验证方案

Phase 1 完成后，至少做以下验证：

### 7.1 编译验证

```bash
cd packages/core && npx tsc --noEmit
```

### 7.2 回归测试

优先跑与 graph / retry / strategy / execution 相关的核心测试。

若全量可跑：

```bash
pnpm test
```

### 7.3 手工逻辑校验

至少确认：

1. `typescript-lib` 默认策略仍可运行
2. `react-app` / `node-server` 的 `allowedCommands` 可影响 `run_command`
3. 非允许扩展名在 `buildGraph()` 直接失败
4. tester 节点和 implementer 节点能走不同模型路由
5. log 中可看到模型名与 route reason

---

## 8. 成功定义

当且仅当满足以下条件时，Phase 1 视为完成：

1. `nodeRole` 已进入 runtime 决策，不再只是 planner 元数据
2. `model-router` 成为选模入口
3. `allowedExtensions` 和 `allowedCommands` 都被强 enforce
4. 旧配置兼容，没有破坏当前默认链路
5. 编译通过，核心测试通过

