# SpecShip Temporal 替换技术方案（仅方案，不含代码改造）

## 1. 文档目的

本文档用于指导 SpecShip 将当前手写调度/恢复链路替换为 Temporal 编排体系，重点说明：

1. 为什么要替换（收益与依据）。
2. 替换后的目标逻辑链路与系统边界。
3. 具体实施步骤（分阶段、可回滚）。
4. 风险、约束与验收标准。
5. 参考资料（官方文档为主）。

---

## 2. 当前实现概览与问题

### 2.1 当前主链路（简化）

1. `POST /api/run` 创建 project/session 并启动引擎。
2. Planner 生成执行图（DAG）。
3. 调度器并行执行 ready 节点（`Promise.race` 风格循环）。
4. 节点执行后做 verify/review，失败重试，成功解锁下游。
5. 通过 checkpoint + SSE 给前端状态。

### 2.2 当前痛点（需要平台化能力）

1. 调度、重试、恢复是业务代码自维护，复杂度高且容易状态漂移。
2. 中断恢复依赖本地 checkpoint 文件，跨进程/跨实例可靠性弱。
3. 节点级失败隔离与全局任务一致性靠手写状态机兜底，维护成本高。
4. 事件追踪链路不统一，后续做审计/追责/回放成本高。
5. 随并发和长任务规模上升，可靠性与可运维性压力会快速放大。

---

## 3. 选型结论：直接采用 Temporal

### 3.1 结论

采用 Temporal 替换当前“手写编排 + 文件 checkpoint”的控制平面。  
保留 SpecShip 现有业务语义（planner/implementer/verify/review）与前端交互模型，替换的是“执行控制内核”。

### 3.2 核心收益（对应 Temporal 原生能力）

| 诉求 | Temporal 能力 | 对 SpecShip 的直接价值 |
|---|---|---|
| 任务可恢复 | Workflow Event History + Replay | 进程重启后自动恢复，不靠手写 checkpoint 修复 |
| 自动重试 | Activity Retry Policy | 节点失败重试策略平台化，降低手写分支复杂度 |
| 人工介入 | Signals / Queries | `resume/retry/skip` 变为标准消息机制 |
| 并发调度 | Task Queue + Worker 模型 | 节点执行水平扩展，不改业务编排语义 |
| 长流程稳定性 | Continue-As-New | 超长执行流程避免历史膨胀 |
| 可观测性 | Temporal Web + 历史事件 | 每次状态转移可追溯，可定位执行细节 |

### 3.3 决策依据（可核查）

1. Temporal Workflow Execution 与 Event History 机制。
2. Temporal Activity Retry Policy。
3. Temporal Signals/Queries（控制与查询分离）。
4. Temporal TypeScript SDK 的 Worker/Workflow/Activity 分层模型。
5. Temporal 自托管与 CLI 本地开发支持。

---

## 4. 目标架构（替换后）

### 4.1 组件边界

1. API 服务（现有 `apps/server`）  
职责：接收请求、启动 Workflow、发送 Signal、Query 状态、SSE 推送。

2. Temporal 服务端（自托管或托管）  
职责：保存执行历史、调度任务、保障故障恢复。

3. Worker 服务（新增）  
职责：消费 Task Queue，执行 Activities（planner、implement、verify、review、产物落盘、证据写入）。

4. 存储层（建议 Postgres）  
职责：项目元数据、会话索引、文件索引、业务审计补充（非 Temporal 核心历史）。

### 4.2 逻辑链路（目标）

1. `POST /api/run`  
创建 run 元信息 -> `client.workflow.start(SpecRunWorkflow, { workflowId })`。

2. `SpecRunWorkflow`  
执行规划 Activity -> 生成 DAG -> 并发调度 NodeExecution 子流程（或同流程并发 Activity）-> 汇总状态。

3. `ExecuteNodeActivity`  
执行 implement -> verify -> review；失败由 RetryPolicy 管理；最终返回节点 evidence。

4. 状态更新  
Workflow 内维护节点状态，必要时写业务侧投影（DB）供前端快读。

5. 人工控制  
`/api/resume`、`/api/node/:id/retry`、`/api/node/:id/skip` -> 对应 Workflow Signal。

6. 状态读取  
`/api/status`、会话详情页 -> Workflow Query + 投影表组合读取。

7. 实时推送  
基于 Query 轮询或事件投影变化推送 SSE。

---

## 5. 领域模型映射（当前 -> Temporal）

| 当前概念 | Temporal 映射 |
|---|---|
| project/session/run | 业务元数据 + workflowId 命名空间 |
| ExecutionGraph | Workflow 内状态对象（可投影到 DB） |
| GraphNode | NodeState（Workflow state） |
| executeNode() | Activity（或 Child Workflow） |
| retryCount/maxRetries | Activity Retry Policy + 节点级业务限制 |
| checkpoint 文件 | Temporal Event History（主）+ 投影存储（辅） |
| resume/retry API | Signal 驱动 |

建议 `workflowId` 规范：

`specship:{projectId}:{sessionId}:{runId}`

---

## 6. 关键设计细节

### 6.1 Workflow 拆分建议

1. `SpecRunWorkflow`（主流程）
- 负责 DAG 状态机、并发调度、汇总终态。

2. `NodeExecutionWorkflow`（可选，子流程）
- 当单节点流程很复杂（多步 Activity）时拆子流程，便于隔离与复用。

3. 直接 Activity 模式（起步建议）
- 先把节点执行做成单 Activity，后续再细拆。

### 6.2 Activities 建议列表

1. `PlanGraphActivity(spec, repoContext)`  
2. `ImplementNodeActivity(nodeInput)`  
3. `VerifyNodeActivity(nodeOutput)`  
4. `ReviewNodeActivity(nodeOutput)`  
5. `PersistEvidenceActivity(evidence)`  
6. `WriteProjectionActivity(stateDelta)`（可选）

### 6.3 Retry 策略建议

1. implement/review 采用指数退避重试。
2. verify 中编译错误可短间隔重试；确定性逻辑错误重试次数受限。
3. 所有重试策略在 ActivityOptions 中集中定义，避免散落在业务代码分支。

### 6.4 Signal / Query 约定

Signals（写操作）：

1. `resumeRun`
2. `retryNode(nodeId)`
3. `skipNode(nodeId, reason)`
4. `cancelRun(reason)`

Queries（读操作）：

1. `getRunSummary`
2. `getNodeStatuses`
3. `getNodeEvidence(nodeId)`
4. `getPendingHumanActions`

### 6.5 Determinism 约束（必须遵守）

Workflow 代码中不得直接做不确定性副作用（如随机数、当前时间、IO、网络、文件写入等），这类操作必须放到 Activity。  
否则重放时可能导致 Non-Deterministic Error。

---

## 7. 实施计划（分阶段，可回滚）

### Phase 0：准备与基线（1-2 天）

1. 明确切换目标：仅替换编排内核，不改产品外部 API 语义。
2. 冻结当前关键路径行为（run/resume/retry/status/SSE）并记录回归用例。
3. 定义统一 ID 规范（project/session/run/workflowId）。

交付物：

1. 回归用例清单。
2. Temporal 命名与队列命名规范文档。

### Phase 1：基础设施落地（1-2 天）

1. 以 Temporal dev server 建立本地开发环境。
2. 引入 TypeScript SDK 依赖（client/worker/workflow/testing）。
3. 配置 `namespace/taskQueue`，完成 Worker 启动脚本。

交付物：

1. 本地可启动 Temporal + Worker。
2. 健康检查与基本 smoke test。

### Phase 2：最小可运行流程（3-5 天）

1. 新增 `SpecRunWorkflow` 骨架（只跑一条示例节点）。
2. 将当前 `executeNode` 逻辑先包装为一个 Activity。
3. API `/run` 从“直接调用 run()”改为“启动 Workflow”。
4. API `/status` 改为 Query 读取。

交付物：

1. 单节点流程可完整跑通（start -> done/failed）。
2. 可从 Temporal UI 看到历史与重试。

### Phase 3：完整图调度与控制信号（4-7 天）

1. 接入 DAG 并发调度策略（ready 节点并发执行）。
2. 接入 `resume/retry/skip/cancel` Signals。
3. 接入节点证据落库与前端状态投影。
4. 接入 SSE 推送适配（基于投影变化或 Query 拉取）。

交付物：

1. 多节点并发执行可用。
2. 手动控制链路可用。

### Phase 4：灰度与切换（2-4 天）

1. 引入 `ORCHESTRATOR_MODE=legacy|temporal` 开关。
2. 双跑对比（同 spec 对比结果一致性与耗时）。
3. 逐步将默认模式切换为 Temporal，保留 legacy 快速回退。

交付物：

1. 灰度报告（成功率、平均耗时、失败类型分布）。
2. 切换/回滚操作手册。

---

## 8. API 兼容策略

目标：前端尽量无感。

1. `/api/run` 入参与返回结构保持不变；内部实现改为启动 Workflow。
2. `/api/resume` 改为发送 Signal，不再依赖本地 checkpoint。
3. `/api/node/:id/retry` 改为发送节点重试 Signal。
4. `/api/status` 优先读 Query，必要时结合投影缓存提升性能。
5. `/api/projects/:pid/sessions/:sid/graph` 从投影层读取，而非文件恢复。

---

## 9. 运维与安全策略

### 9.1 运维

1. 定义 Worker 并发、Task Queue 隔离策略（planning/implementation/verification 可分队列）。
2. 给每类 Activity 配置超时、重试上限、告警阈值。
3. 引入基础指标：工作流成功率、平均时延、重试次数、队列堆积。

### 9.2 安全

1. 工具执行 Activity 与 Workflow 分离，限制执行权限。
2. 文件操作统一路径白名单校验（session output 根路径约束）。
3. 对高风险命令执行加入 allowlist 与审计日志。

---

## 10. 风险与缓解

| 风险 | 说明 | 缓解措施 |
|---|---|---|
| Determinism 违规 | Workflow 写了不确定逻辑导致重放失败 | 代码审查清单 + workflow 单测 + 副作用全部下沉 Activity |
| 迁移期间行为漂移 | 新旧编排输出不一致 | 双跑对比 + 关键路径回归用例 |
| 长历史性能下降 | 超长流程历史膨胀 | Continue-As-New 策略 |
| 运维复杂度上升 | 引入新基础设施 | 标准化部署脚本 + 运维手册 + 监控告警 |

---

## 11. 回滚方案

1. 保留 legacy orchestrator 路径与开关：
- `ORCHESTRATOR_MODE=legacy` 立即回退旧路径。

2. 回滚触发条件（任一满足）：
- Temporal 路径成功率连续低于阈值。
- 核心 API 不可用时长超过 SLO。
- Workflow determinism 错误频发且短期无法修复。

3. 回滚执行步骤：
- 切配置 -> 重启 API/Worker（或仅 API）-> 恢复 legacy。
- Temporal 运行中的 workflow 保留，不删除，用于问题复盘。

---

## 12. 验收标准（Definition of Done）

1. 功能一致性：
- `run/resume/retry/status` 在 Temporal 模式可用且与既有语义一致。

2. 可靠性：
- 进程重启后，运行中任务可恢复继续。

3. 可观测性：
- Temporal UI 可追踪完整执行历史与失败原因。

4. 可运维性：
- 有明确队列、重试、超时、告警配置。

5. 可回滚性：
- 单开关回退 legacy 成功。

---

## 13. 参考资料（官方优先）

1. Temporal 文档首页  
https://docs.temporal.io/

2. Workflow Execution（事件历史与执行模型）  
https://docs.temporal.io/workflow-execution

3. Retry Policies  
https://docs.temporal.io/encyclopedia/retry-policies

4. TypeScript SDK 文档入口  
https://docs.temporal.io/develop/typescript

5. Temporal CLI  
https://docs.temporal.io/cli

6. Self-hosted Guide  
https://docs.temporal.io/self-hosted-guide

7.（对比参考）LangGraph Durable Execution  
https://docs.langchain.com/oss/python/langgraph/durable-execution

---

## 14. 附录：建议目录演进（示意）

```
packages/
  engine/                 # 保留业务语义（planner/verify/prompt）
  orchestrator-temporal/  # 新增：workflow/activity/worker/client
apps/
  server/                 # API 层，改为 Temporal client 调用
```

说明：  
第一阶段不强制重构业务包，只需把“执行控制平面”切换到 `orchestrator-temporal`，后续再做内部抽象收敛。
