# packages/core 多模型工作流改造计划

> 状态：提案 / 仅规划，不含实现
> 最后更新：2026-05-11
> 目标对象：`packages/core`

---

## 一、背景

当前 `packages/core` 已经具备较强的 AI 编排基础能力：

- `clarify -> plan -> execute -> verify -> review -> retry` 主链路完整
- 以 `ExecutionGraph` 为中心进行 DAG 化调度
- 每个节点具备明确的输出文件、依赖、状态和 evidence
- 有 checkpoint、session 持久化、execution log、audit log 等可观测机制
- 已支持基础的三模型分工：`planning / implementation / review`

这说明 core 已经完成了从“聊天式 LLM 调用”到“工程化 AI 执行流”的第一阶段演进。

但从更高阶的研发工作流视角看，当前设计仍然存在几个明显瓶颈：

1. **模型分工仍偏粗粒度**
   - 目前只有 planning / implementation / review 三类模型。
   - `clarifier`、`tester`、`utility/editor`、`architect/integrator` 等角色尚未独立建模。

2. **`nodeRole` 语义存在，但未真正驱动 runtime 路由**
   - 除 tester 外，多数 nodeRole 最终仍走同一 implementer prompt 与同一 implementation model。

3. **strategy 抽象已经出现，但和 runtime 约束存在脱节**
   - `allowedExtensions` 没有被完整 enforce。
   - `allowedCommands` 没有真正驱动 `run_command` 白名单。

4. **当前模式偏 output sandbox，不是 repo-native patch workflow**
   - 适合受控生成与原型构建，但不完全适配“对现有大型仓库做定点修改”的真实研发场景。

5. **验收标准仍以自然语言为主，结构化程度不足**
   - reviewer 和 verifier 仍需从文本里理解“什么叫完成”，自动化验收粒度还不够细。

因此，本计划的目标不是推翻现有 core，而是在保留其 DAG、可观测、可恢复、可重试优势的前提下，升级为：

> **面向研发任务的、多模型分层、强边界、强验证、支持 sandbox 与 repo-edit 双模式的 AI 工作流核心。**

---

## 二、改造目标

### 2.1 总目标

将 `packages/core` 从当前的“三段式 LLM 编排器”，演进为：

- **按任务角色与风险动态选择模型**
- **按 nodeRole / strategy / complexity 路由 prompt、tool、verify 行为**
- **既支持 output sandbox，也支持 repo-edit mode**
- **让 acceptance criteria 更结构化、更容易自动验证**
- **使 planner / executor / reviewer / tester / integrator 形成更清晰的职责边界**

### 2.2 设计原则

改造过程中需要保持以下原则不变：

1. **图仍是核心抽象**：所有执行单元继续以 `ExecutionGraph / GraphNode` 表达。
2. **节点必须可重试、可追责、可恢复**：不引入黑盒一步到位流程。
3. **边界优先于智能**：任何新增能力都不能削弱对写入范围、命令范围、验证范围的控制。
4. **默认安全**：高风险能力（repo 改写、命令执行、跨模块修改）需显式开启。
5. **优先增强现有抽象，不轻易重写主调度器**：避免破坏已稳定的运行链路。

---

## 三、当前架构判断

### 3.1 当前架构优点

`packages/core` 目前已经具备以下强项：

- **Spec-driven**：有 `clarifySpec()`、PRD 生成、Planner JSON 输出
- **Graph-driven**：任务被拆成 node，依赖关系清晰
- **Boundary-aware**：写入范围、outputDir、checkpoint、依赖上下文都受到限制
- **Verification-first**：节点完成后必须经过 verify / review 才能 done
- **Recoverable**：graph checkpoint、session graph、resume/retry 逻辑完整
- **Observable**：execution logger、audit log、evidence 记录较完善

### 3.2 当前核心限制

#### 限制 A：模型角色不够细

目前 `ShipyardConfig.models` 只有：

- `planning`
- `implementation`
- `review`

这足以支撑基础链路，但不足以支撑以下场景：

- 用廉价模型处理文案、总结、PR 描述
- 用专用 coder 模型执行实现节点
- 用独立 reviewer 模型减少“自我确认”
- 用更强模型处理 integrator / architecture / cross-cutting node

#### 限制 B：`nodeRole` 只是元数据，不是完整执行契约

目前 `nodeRole` 在 planner JSON 中已经存在，但 runtime 层只有 tester 节点真正走了 tester prompt。

这会导致：

- `types` 与 `implementer` 没有真正的行为差异
- `integrator` / `reviewer` / `util` 等角色不能被单独优化
- “任务分层”只停留在计划文本层，而没有真正进入调度层

#### 限制 C：strategy 已有，但未完全 runtime 化

`TaskStrategy` 已定义：

- planner prompt
- tools
- verify config
- preview config
- implementer / reviewer / tester prompt

但 runtime 仍存在若干硬编码点：

- `llm.ts` 的 `run_command` 白名单没有读取 strategy 配置
- planner 输出文件扩展名未按 `allowedExtensions` 严格校验
- 不同策略的工具能力并没有完全映射到工具执行层

#### 限制 D：repo 修改模式尚未形成正式能力

当前设计更偏向：

- 生成到 session/output
- 在受控目录内逐步构造结果

这很适合原型、实验性实现、生成式任务，但对真实研发中的以下场景支撑不足：

- 修改既有 monorepo 某个 feature 目录
- 限定只改某几个文件
- 保持与现有测试、lint、接口约束一致

#### 限制 E：验收标准不够结构化

当前 acceptance criteria 主要是自然语言字符串，问题在于：

- reviewer 仍需理解语言语义
- verifier 很难做更强的自动校验
- 很多“边界性要求”无法被程序强 enforce

例如：

- 不允许改公共接口
- 只能新增测试，不改实现
- 不允许新增依赖
- 必须导出某些符号
- 必须通过指定命令

这些要求更适合落为结构化字段，而不是长文本。

---

## 四、目标架构（提案）

目标架构分为五层：

```text
人类输入 / 项目上下文
  -> Clarifier 层
  -> Planner / Architect 层
  -> Model Router 层
  -> Executor / Tester / Reviewer / Integrator 层
  -> Verifier / Policy / Persistence 层
```

### 4.1 Clarifier 层

负责：

- 判断 spec 是否缺关键信息
- 在进入 plan 前收集最少量但必要的澄清信息
- 产出结构化 clarification result

### 4.2 Planner / Architect 层

负责：

- 基于 repo context 和 spec 生成可执行图
- 为每个节点定义：role / output scope / acceptance / risk
- 仅在高不确定性决策点插入 checkpoint

### 4.3 Model Router 层（新增）

负责：

- 根据 nodeRole、strategy、任务复杂度、风险等级、重试次数选择模型
- 决定该节点使用哪个 prompt、工具集、验证策略
- 决定失败升级路径（如重试超过阈值后升级到更强模型）

### 4.4 Execution 层

拆分成明确角色：

- **Implementer**：主实现节点
- **Tester**：生成或补充测试
- **Reviewer**：验收与代码审查
- **Integrator**：跨模块衔接、入口接线、系统级整合
- **Utility**：PR 描述、文档更新、文案润色、变更摘要

### 4.5 Policy / Verification / Persistence 层

继续负责：

- output scope / repo scope 校验
- command allowlist 校验
- compile / lint / test / integration verify
- graph checkpoint / session persistence / audit logging

---

## 五、重点改造方向

---

### 方向 1：把模型配置从 3 角色扩展为“角色 + 路由规则”

#### 现状

`config.ts` 里只有：

```ts
models: {
  planning: string;
  implementation: string;
  review: string;
}
```

#### 目标

扩展为更细粒度的模型配置，例如：

```ts
models: {
  clarifier: string;
  planner: string;
  architect: string;
  implementer: string;
  tester: string;
  reviewer: string;
  integrator: string;
  utility: string;
}
```

并新增一层路由策略：

```ts
modelRouting: {
  retryEscalation: boolean;
  highRiskRoles: string[];
  smallTaskModel?: string;
  mediumTaskModel?: string;
  highTaskModel?: string;
}
```

#### 设计意图

- “模型选择”不再只是全局配置，而是 runtime 决策的一部分
- 为“强模型做规约、中模型做实现、小模型做低风险辅助”提供正式支持
- 为后续成本优化与 SLA 优化预留空间

#### 涉及文件

- `packages/core/src/config.ts`
- `packages/core/src/ai/llm-config.ts`
- 新增：`packages/core/src/orchestrator/model-router.ts`

---

### 方向 2：让 `nodeRole` 真正驱动 runtime

#### 现状

`GraphNode.nodeRole` 已存在，但除 tester 外未真正影响执行模型、prompt、工具与验证路径。

#### 目标

让 `nodeRole` 成为一等执行契约。建议将角色收敛为：

- `clarifier`
- `planner`
- `types`
- `implementer`
- `tester`
- `reviewer`
- `integrator`
- `utility`
- `checkpoint`

并在 runtime 中做映射：

- 选哪个模型
- 用哪个 system prompt
- 开哪些工具
- 是否允许写实现文件 / 测试文件 / 文档文件
- 使用什么 verify 流程

#### 设计意图

把“任务角色”从 prompt 描述升级为 runtime policy，避免所有节点都被同一 implementer 逻辑吞掉。

#### 涉及文件

- `packages/core/src/graph/graph.ts`
- `packages/core/src/orchestrator/node-executor.ts`
- `packages/core/src/orchestrator/review.ts`
- `packages/core/src/orchestrator/planner.ts`
- 新增：`packages/core/src/orchestrator/node-role-policy.ts`

---

### 方向 3：补齐 strategy 与 runtime 之间的契约

#### 现状

strategy 已抽象出：

- `plan()`
- `tools()`
- `verify()`
- `preview()`
- prompts

但 runtime 尚未完全按 strategy enforce。

#### 改造项

##### 3.1 强制校验 `allowedExtensions`

planner 输出 step 时，必须确保 `outputFile` 扩展名属于当前 strategy 的允许集合。

##### 3.2 让 `allowedCommands` 真正驱动 `run_command`

将命令白名单从 `llm.ts` 中的硬编码数组迁移到 runtime 注入配置。

##### 3.3 tools 与执行器解耦

避免 `llm.ts` 内部静态 TOOLS 与 strategy 内 `tools()` 双维护。

可考虑：

- 将工具 schema 与工具执行器注册表统一放入 `tools/` 子模块
- `strategy.tools()` 返回工具 capability 列表
- runtime 基于 capability 装配实际工具执行器

#### 涉及文件

- `packages/core/src/strategies/base.ts`
- `packages/core/src/strategies/index.ts`
- `packages/core/src/ai/llm.ts`
- `packages/core/src/orchestrator/planner.ts`
- 新增：`packages/core/src/tools/*`

---

### 方向 4：增加 `repo-edit mode`，形成双执行模式

#### 现状

当前默认写到 `outputDir`，适合沙盒生成。

#### 目标

新增双模式：

##### 模式 A：`sandbox-output`

- 保持现状
- 只允许写到 session output 目录
- 适合生成新模块、原型、独立项目、实验性任务

##### 模式 B：`repo-edit`

- 允许在 `repoPath` 下指定范围内做 in-place 修改
- 每个 node 仍需显式声明可写路径
- 强制记录改动范围、diff 摘要、验证命令

#### 设计意图

让 core 不只服务“生成式输出”，还可以服务真实研发中的“局部增量改造”。

#### 关键约束

repo-edit 模式必须至少具备：

- `allowedWriteGlobs`
- `forbiddenPaths`
- `commandPolicy`
- `requireVerification`
- `dryRun / patch summary`

#### 涉及文件

- `packages/core/src/config.ts`
- `packages/core/src/orchestrator/output-policy.ts`
- `packages/core/src/orchestrator/node-executor.ts`
- `packages/core/src/context/repo.ts`
- 新增：`packages/core/src/orchestrator/workspace-policy.ts`

---

### 方向 5：把 acceptance criteria 升级为“文本 + 结构化约束”双轨制

#### 现状

`acceptanceCriteria` 是字符串。

#### 目标

在保留自然语言描述的同时，引入结构化验收字段，例如：

```ts
acceptance: {
  summary: string;
  exports?: string[];
  compile?: boolean;
  lint?: boolean;
  tests?: {
    required: boolean;
    files?: string[];
  };
  writeScope?: string[];
  forbiddenEdits?: string[];
  dependencies?: {
    allowNewPackages: boolean;
  };
}
```

#### 设计意图

- reviewer 使用文本 + 结构化信息共同评审
- verifier 可以直接根据结构化字段执行检查
- node 的“完成定义”更可编程

#### 涉及文件

- `packages/core/src/graph/graph.ts`
- `packages/core/src/orchestrator/planner.ts`
- `packages/core/src/orchestrator/review.ts`
- `packages/core/src/verification/verify.ts`

---

### 方向 6：引入复杂度 / 风险感知的模型路由

#### 目标

基于以下因子为 node 做模型选择：

- `nodeRole`
- `dependsOn` 数量
- 是否修改公共接口
- 是否为 repo-edit
- 文件数量与上下文耦合度
- 是否为 retry 场景
- 是否处于 integration / checkpoint 前后

#### 路由建议

- **低风险 / 小范围 / 独立实现** -> 小/中模型
- **复杂实现 / 跨模块衔接** -> 中/强模型
- **架构、review、integration、retry escalated** -> 强模型

#### 升级规则建议

- retry 超过 1 次：提升一级模型
- review 连续失败：切换 reviewer 或升级 implementer
- repo-edit + public API touching：直接走高等级模型

#### 涉及文件

- 新增：`packages/core/src/orchestrator/model-router.ts`
- `packages/core/src/orchestrator/node-executor.ts`
- `packages/core/src/orchestrator/post-node-handler.ts`

---

### 方向 7：把 tester / utility 变成正式流水线角色

#### 现状

当前 tester pass 已存在，但更像后置补充机制。

#### 目标

将 tester / utility 正式纳入图模型：

- planner 可以显式产出 tester / utility 节点
- 对实现节点的测试补充不再只是隐式追加，也可以由 planner 明确指定
- 文档更新、PR 描述、变更摘要、migration note 等可由 utility 节点负责

#### 设计意图

让“实现之外的研发劳动”也进入 graph orchestration，而不是留给外层人工补齐。

#### 涉及文件

- `packages/core/src/orchestrator/planner.ts`
- `packages/core/src/orchestrator/tester-pass.ts`
- `packages/core/src/graph/graph.ts`
- 新增：`packages/core/src/orchestrator/utility-pass.ts`

---

## 六、推荐实施顺序

为避免一次性重构过大，建议分四个阶段推进。

---

### Phase 1：补齐 runtime 契约，不改主流程

目标：先修“抽象存在但未落地”的问题。

#### 任务

1. 扩展 `ShipyardConfig.models`
2. 新增 `model-router.ts`，先做静态路由
3. `allowedExtensions` 在 `buildGraph()` 中强校验
4. `allowedCommands` 接入真实 `run_command` 校验
5. 将 nodeRole -> prompt/model/tool 的映射收口到统一模块

#### 预期收益

- strategy 与 runtime 一致
- 不同角色真正拥有不同执行策略
- 为后续复杂演进建立稳定基础

#### 风险

- 改动较分散，容易出现配置与默认值不兼容
- 需要补足测试，避免 legacy strategy 被破坏

---

### Phase 2：引入复杂度感知路由

目标：从“固定角色用固定模型”升级为“按任务特征动态选模型”。

#### 任务

1. 定义 node complexity / risk 评分规则
2. 在执行前计算 node profile
3. retry 时支持模型升级
4. reviewer 与 implementer 支持独立模型策略

#### 预期收益

- 成本更可控
- 小任务不再浪费强模型
- 高风险任务稳定性提升

#### 风险

- 路由规则过度复杂会导致调试困难
- 需要 execution log 明确记录“为什么选这个模型”

---

### Phase 3：正式引入 repo-edit mode

目标：从生成沙盒扩展到真实仓库增量修改。

#### 任务

1. 定义 workspace policy / write scope 结构
2. 为 repo-edit 模式加可写范围校验
3. 为 repo-edit 模式设计更强的 verify 流程
4. 让 planner 能显式输出“修改已有文件”的节点

#### 预期收益

- 更贴近真实研发工作流
- 可直接用于 monorepo feature 修改、bugfix、局部重构

#### 风险

- 这是最敏感的阶段，若边界收不紧，容易破坏仓库
- 需要强制 dry-run / audit / diff summary

---

### Phase 4：结构化验收 + 完整角色化

目标：把 core 从“多阶段 LLM 编排器”升级为“任务规格驱动的研发工作流核心”。

#### 任务

1. 引入结构化 acceptance schema
2. tester / utility / integrator 节点正式化
3. 调整 reviewer / verifier 以消费结构化约束
4. 补足前端展示（角色、模型路由、风险等级、执行模式）

#### 预期收益

- 验收更可编程
- 更适合长生命周期的 AI 研发任务
- 更利于后续接 Temporal / policy engine / enterprise guardrails

---

## 七、建议新增/调整的文件

### 7.1 建议新增文件

```text
packages/core/src/orchestrator/model-router.ts
packages/core/src/orchestrator/node-role-policy.ts
packages/core/src/orchestrator/workspace-policy.ts
packages/core/src/tools/index.ts
packages/core/src/tools/file-tools.ts
packages/core/src/tools/command-tools.ts
packages/core/src/tools/search-tools.ts
packages/core/src/tools/tool-runtime.ts
```

### 7.2 重点修改文件

```text
packages/core/src/config.ts
packages/core/src/graph/graph.ts
packages/core/src/ai/llm.ts
packages/core/src/orchestrator/planner.ts
packages/core/src/orchestrator/node-executor.ts
packages/core/src/orchestrator/post-node-handler.ts
packages/core/src/orchestrator/review.ts
packages/core/src/orchestrator/output-policy.ts
packages/core/src/verification/verify.ts
packages/core/src/strategies/base.ts
packages/core/src/strategies/index.ts
```

---

## 八、建议的数据结构变化

### 8.1 `ShipyardConfig` 建议扩展

```ts
interface ShipyardConfig {
  workDir: string;
  repoPath?: string;
  executionMode?: "sandbox-output" | "repo-edit";

  models: {
    clarifier: string;
    planner: string;
    architect: string;
    implementer: string;
    tester: string;
    reviewer: string;
    integrator: string;
    utility: string;
  };

  routing?: {
    enableDynamicRouting: boolean;
    retryEscalation: boolean;
    highRiskRoles: string[];
  };

  workspacePolicy?: {
    allowedWriteGlobs?: string[];
    forbiddenPaths?: string[];
    allowNewDependencies?: boolean;
  };
}
```

### 8.2 `GraphNode` 建议扩展

```ts
interface GraphNode {
  nodeRole: string;
  riskLevel?: "low" | "medium" | "high";
  executionMode?: "sandbox-output" | "repo-edit";

  acceptance?: {
    summary: string;
    exports?: string[];
    compile?: boolean;
    lint?: boolean;
    testsRequired?: boolean;
    allowedWriteGlobs?: string[];
    forbiddenEdits?: string[];
  };

  executionProfile?: {
    selectedModel?: string;
    routeReason?: string;
    strategyId?: string;
  };
}
```

---

## 九、可观测性要求（必须补）

如果引入多模型路由与 repo-edit mode，日志与 evidence 也必须同步升级。

建议新增记录内容：

- 本节点最终选择的模型
- 选择原因（role / complexity / retry escalation / strategy）
- 本节点执行模式（sandbox-output / repo-edit）
- 本节点允许写入范围
- 实际写入文件与预期范围差异
- 若发生模型升级，升级前后的模型名

这部分建议接入：

- `execution.log.jsonl`
- node evidence
- 前端 node detail panel

---

## 十、验收标准（针对本次改造计划，而非业务功能）

完成本计划的“第一阶段落地”后，至少应满足以下标准：

1. `nodeRole` 能真正影响执行模型、prompt、工具与 verify 路径。
2. `allowedExtensions` 与 `allowedCommands` 被 runtime 强制执行，而非只存在于 strategy 声明中。
3. execution log 能记录每个节点的模型选择与路由原因。
4. 在不启用 repo-edit mode 时，现有 sandbox-output 行为保持兼容。
5. repo-edit mode 仅在显式开启时生效，且必须要求 write scope policy。
6. retry 时支持模型升级或 reviewer/implementer 分流。
7. strategy、router、policy 三者的责任边界清晰，不再由 `llm.ts` 承担过多硬编码策略。

---

## 十一、非目标（本轮不做）

以下方向有价值，但不应和本轮改造绑定：

1. **把 core 改成真正多 agent 长对话系统**
   - 本轮目标是“多角色 runtime 路由”，不是“持久会话式 agent 团队”。

2. **一次性重做前端交互层**
   - 前端只需补展示，不应该反向驱动 core 大改。

3. **引入过重的策略 DSL 或复杂规则引擎**
   - 先用 TypeScript 配置和显式函数实现，保持可调试性。

4. **立刻覆盖所有策略与语言**
   - 第一阶段优先稳定 `typescript-lib / react-app / node-server` 三类高频场景。

---

## 十二、开放问题

### Q1：repo-edit mode 是否必须要求人工审批？

建议：至少在第一版中，对以下情况要求显式审批或 checkpoint：

- 修改公共接口
- 修改 package.json / lockfile
- 修改 CI / build config
- 修改超过 N 个文件

### Q2：model-router 应该是纯规则，还是允许 LLM 辅助？

建议：第一版坚持**纯规则**，避免“模型自己决定用哪个模型”的不稳定性。

### Q3：是否要把 planner 输出改成更强 schema？

建议：分两步走。

- 先保留当前 planner JSON 格式，增加少量字段
- 等 runtime 稳定后，再逐步把 acceptance 等内容结构化

---

## 十三、建议的近期执行顺序

如果立刻开始做，我建议按以下顺序推进：

1. **先做 Phase 1**
   - 补齐 `model-router`
   - 补齐 `allowedExtensions / allowedCommands` enforce
   - 让 `nodeRole` 真正进入 runtime

2. **再做 Phase 2**
   - 风险 / 复杂度路由
   - retry escalation

3. **然后做 Phase 3**
   - repo-edit mode
   - write scope policy

4. **最后做 Phase 4**
   - 结构化 acceptance
   - tester / utility / integrator 正式化

---

## 十四、一句话总结

当前 `packages/core` 已经证明了 Shipyard 的方向是成立的：

> **AI 开发不是一次大 prompt，而是一个“任务图 + 边界控制 + 验证闭环”的工程系统。**

下一步的关键，不是再让单个模型更“聪明”，而是让 core：

- 更会根据任务分层选择模型
- 更会根据角色与策略切换执行方式
- 更能在真实仓库中安全、可验证地工作

也就是说，本次改造的核心目标是：

> **把现有的 AI 编排核心，升级为一个真正面向研发场景的、多模型、强约束、可交付工作流引擎。**
