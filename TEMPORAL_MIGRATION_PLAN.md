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

现有代码中已知违规点（迁移时必须处理）：

| 位置 | 违规操作 | 处理方式 |
|---|---|---|
| `shipyard.ts executeNode()` L140 | `fs.unlinkSync` 删旧文件 | 下沉到 `ImplementNodeActivity` |
| `shipyard.ts executeNode()` L155 | `fs.readFileSync` 读依赖文件 | 下沉到 `ImplementNodeActivity` |
| `shipyard.ts executeNode()` L218 | `new Date().toISOString()` | 改用 `workflow.now()` 或在 Activity 内记录 |
| `verify.ts runCompileCheck()` L34 | `execSync("npx tsc ...")` | 下沉到 `VerifyNodeActivity` |
| `verify.ts runBehaviorVerification()` L211 | `execSync("ts-node ...")` | 下沉到 `VerifyNodeActivity` |
| `shipyard.ts runCodeReview()` L252 | `runAgent(REVIEWER_PROMPT)` 网络调用 | 下沉到 `ReviewNodeActivity` |

---

### 6.6 【争议点 A】implement → verify → review 的 Activity 粒度

**背景**：现有代码中 `executeNode()` + `verifyNode()` + `runCodeReview()` 是顺序调用的，形成一个节点的完整生命周期。迁移时有两种拆法。

#### 选项 A1：三合一（单 Activity `ExecuteNodeActivity`）

将 implement → verify → review 整体包装为一个 Activity，内部逻辑与现有 `shipyard.ts` 的流程基本一致。

```
ExecuteNodeActivity(nodeInput) {
  implement()  →  verify()  →  review()
  失败 → 抛出 ApplicationError → Temporal RetryPolicy 触发
}
```

**如果选了这个选项：**

优点：
- 迁移成本最低，现有 `executeNode + verifyNode + runCodeReview` 近乎平移。
- 重试语义清晰：整个节点从头重试，与现有行为一致，回归测试通过率高。
- Temporal UI 里每个节点是一个 Activity，历史简洁，易读。

缺点：
- verify 失败重试时会重新跑 implement（即使 implement 本身没问题），浪费 LLM Token。
- Activity 超时难以设置：implement 可能很慢，review 很快，单一超时值不好配置。
- 错误类型无法区分：compile 失败和 review 失败使用同一个重试策略，精细化控制困难。
- 未来想单独重跑 verify（例如环境问题导致 tsc 超时）时，整个节点必须重跑。

**建议场景**：Phase 2 起步使用，快速跑通端到端。

---

#### 选项 A2：三分离（三个独立 Activity）

```
ImplementNodeActivity  →  VerifyNodeActivity  →  ReviewNodeActivity
各自独立的 RetryPolicy     短间隔重试              指数退避重试
```

**如果选了这个选项：**

优点：
- 每步失败只重试自身：verify 超时只重跑 verify，不浪费 implement 的 LLM 调用。
- 不同 Activity 可以配置不同的超时和重试策略（compile 错误 vs LLM 调用 vs review）。
- Temporal UI 可以精确看到是哪一步失败，可观测性更好。
- 为未来"人工确认 verify 后继续"预留了自然插入点（在 Verify 和 Review 之间加 Signal 等待）。

缺点：
- implement 产出的文件路径需要作为返回值传给 VerifyNodeActivity，Activity 间存在数据传递耦合。
- 当 verify 失败需要重新 implement（如编译错误暴露了逻辑问题）时，需要在 Workflow 层写回退逻辑，复杂度上升。
- 现有代码里 `executeNode` 内的"重试时注入 lastError 到 prompt"的逻辑需要显式在 Workflow 层维护。
- Temporal UI 中一个节点对应三条 Activity 历史，需要约定命名规范才不会混乱。

**建议场景**：Phase 3 重构时引入，以 A1 为基础逐步拆分。

---

#### 当前推荐路径

> Phase 2 用 A1，Phase 3 末期将 verify/review 从 `ExecuteNodeActivity` 中拆出，形成 A2。  
> 拆分时机：当重试日志中出现"因 verify 超时导致 implement 重跑"的情况超过一定比例时触发。

---

### 6.7 【争议点 B】DAG 状态（ExecutionGraph）存在哪里

**背景**：现有代码用 `Map<string, GraphNode>` 在内存中维护整个 DAG 状态，并通过 checkpoint 文件持久化。Temporal Workflow 有自己的状态模型，但 `ExecutionGraph` 包含 `Map` 类型，序列化存在问题。

#### 选项 B1：DAG 状态完全存 Workflow State

将 `ExecutionGraph` 作为 Workflow 的内部状态变量，完全依赖 Temporal Event History 持久化。

**如果选了这个选项：**

优点：
- 单一事实来源：DAG 状态只在 Temporal 里，不存在状态漂移。
- 不需要维护额外的 DB 表或投影逻辑。
- 进程重启后 Temporal 自动 Replay，DAG 状态自动恢复。

缺点：
- `ExecutionGraph` 使用了 `Map<string, GraphNode>`，Temporal 序列化要求纯 JSON 对象，**需要将 `Map` 改为 `Record<string, GraphNode>`**，有改造成本。
- DAG 节点很多时（50+ 节点），每次状态变更都写入 Event History，历史会快速膨胀，需要提前规划 Continue-As-New 阈值。
- 前端读状态只能通过 Query（或投影缓存），Query 有一定延迟，无法做到真正实时推送。

---

#### 选项 B2：Workflow 只存 nodeId → status 的轻量映射，完整数据存 DB

Workflow 内部只维护 `Record<string, NodeStatus>`，完整的 `GraphNode`（含 evidence、fileRecords 等）写入 Postgres 投影表。

**如果选了这个选项：**

优点：
- Workflow State 轻量，Event History 膨胀速度慢，Continue-As-New 压力小。
- 前端可以直接查 DB，不必等 Query 响应，读性能好。
- `GraphNode` 的大字段（evidence、toolCalls 等）天然落库，便于后续审计查询。

缺点：
- 引入了两个状态源（Temporal + DB），需要保证最终一致性，否则出现状态漂移。
- 每个 Activity 完成后需要额外调用 `WriteProjectionActivity` 写 DB，增加一次 Activity 调用开销。
- 故障恢复时，如果 DB 写入失败但 Temporal 状态已推进，需要有补偿机制。

---

#### 当前推荐路径

> 采用 **B2 轻量映射**，理由：
> 1. 现有 `Evidence` 字段（`toolCalls`、`filesWritten` 等）数据量大，不适合全量放 Workflow State。
> 2. 前端 SSE 推送依赖低延迟状态读取，DB 投影比 Query 更适合高频读场景。
> 3. `Map → Record` 的改造可以推迟，不阻塞 Phase 2。

---

### 6.8 【争议点 C】verify 失败的重试语义

**背景**：现有代码区分了两类 verify 失败（`verify.ts` 第 247 行有编译失败短路逻辑），但重试策略都一样——将失败信息注入 prompt 后重新 implement。迁移后 Temporal 的 RetryPolicy 是 Activity 级别的，需要明确哪类错误触发哪种策略。

#### 选项 C1：所有 verify 失败统一重试策略

不区分错误类型，统一使用指数退避，`maxAttempts` 由配置决定。

**如果选了这个选项：**

优点：
- 配置简单，与现有 `maxRetries` 逻辑对齐，迁移成本低。
- Temporal 原生的 RetryPolicy 直接覆盖，无需额外判断逻辑。

缺点：
- compile 错误（确定性失败，重试有意义）和 LLM 调用超时（随机性失败，短间隔重试更合适）使用同一策略，资源浪费。
- verify 里的"确定性逻辑错误"（如代码语义错误）会被无意义地重试多次，消耗 Token。

---

#### 选项 C2：按错误类型区分重试策略

通过 Temporal 的 `ApplicationFailure.nonRetryable()` 标记不可重试错误，其余走正常重试。

```typescript
// VerifyNodeActivity 内部
if (compileResult.type === 'deterministic_logic_error') {
  throw ApplicationFailure.nonRetryable('Logic error requires human intervention');
}
// 其他失败正常抛出，由 RetryPolicy 重试
throw new Error(compileResult.output);
```

**如果选了这个选项：**

优点：
- 精确控制哪类错误值得重试，避免无效 Token 消耗。
- 不可重试错误直接进入 `failed` 状态，触发人工介入 Signal 流程，更清晰。
- 与 Temporal 的错误分类机制完全对齐，是 Temporal 推荐的最佳实践。

缺点：
- 需要对现有 `VerificationRecord` 的错误类型做分类标注（`compile` / `behavior` / `timeout` 等），有额外改造工作量。
- 错误分类本身有歧义（"这个 compile 错误是确定性的吗？"），分类逻辑需要仔细设计。

---

#### 当前推荐路径

> Phase 2 用 C1（简单统一），Phase 3 引入 C2 的分类逻辑。  
> 具体分类建议：
> - `compile` 错误 → 可重试（LLM 可能修复）
> - `behavior` hard 测试失败 → 可重试（LLM 可能修复）
> - `behavior` 失败超过 `maxRetries` → `ApplicationFailure.nonRetryable()`
> - Activity 调用超时（LLM 网络问题）→ 短间隔重试，独立 `maxAttempts=3`

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
