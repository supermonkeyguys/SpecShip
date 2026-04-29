# Product Principles

> Shipyard 的产品第一性原则与 chat / clarification / session 设计准则。

这份文档不是某个单一 AI 的提示词，而是整个项目的**产品与架构决策依据**。
在涉及 chat、clarification、session、resume、执行流控制时，应优先遵守这里的原则，而不是临时按模型行为做判断。

---

## 1. 产品定位

Shipyard **不是一个聊天助手**，也不是一个“更聪明的输入框”。

它的本质是一个：

**Session-first 的 AI execution workspace**

也就是说：

- Chat 只是输入层
- Session 才是任务与状态的承载单元
- Execution 才是产品主流程
- Files / Canvas / Logs / Resume 才是核心用户价值

### 1.1 设计含义

因此，产品优化目标不应是“更像人聊天”，而应是：

- 可预测
- 可解释
- 可恢复
- 可复现
- 可追踪

如果某个体验在“更自然”和“更稳定”之间存在冲突，默认优先 **稳定与可控**。

---

## 2. 第一性原则

## P1. Chat 是输入层，不是决策层

用户在 Chat 中输入自然语言，只代表一种**表达方式**。

这不意味着：

- 所有产品行为都应该由 chat 直接决定
- 所有分流都应该交给 LLM 即时判断
- 系统可以把任务控制流伪装成“自由对话”

正确做法是：

- Chat 负责采集意图
- 路由层负责决定进入哪条产品流程
- 执行层负责真正启动 / 恢复 / 修改任务

---

## P2. 关键控制流必须 deterministic first，LLM second

下列行为属于**关键控制流**：

- 是否是 new run
- 是否是 modify current session
- 是否需要 clarification
- 是否 resume
- 是否 retry 某节点
- 是否创建新 session

这些行为不能仅依赖概率模型的单次输出。

### 规则

- 先用稳定规则 / 显式状态做决策
- 再让 LLM 负责理解、补全文案、生成问题、润色 spec

### 禁止事项

不要把以下行为完全外包给 LLM：

- “这次要不要弹 clarification card”
- “这句话到底算新任务还是修改当前任务”
- “是否应该继续沿用旧 session 上下文”

---

## P3. 相同输入 + 相同上下文，必须得到相同路由结果

这是产品一致性的基本要求。

对于同一个 session、同一种路由模式、同一条规范化输入：

- intent 应稳定
- clarification policy 应稳定
- session 归属应稳定

不能出现：

- 同一句话一会儿弹 clarification，一会儿直接执行
- 同一句话一会儿新建 session，一会儿修改当前 session

如果发生这种情况，说明系统把产品决策交给了概率波动，而不是状态机。

---

## P4. 原始用户输入是最高优先级事实，不应先被模型改写再用于判定

系统可以生成：

- normalized intent
- derived spec
- enriched execution brief

但这些都只是**派生物**。

真正的事实源应始终保留：

- raw user message

### 规则

- clarification 是否触发，应优先基于原始用户输入判断
- 不要先让 `/chat` 把用户意图改写成另一段 spec，再拿改写结果去决定是否需要 clarification
- 如果需要对 spec 做结构化整理，应发生在路由与 clarification 之后

---

## P5. 澄清是产品策略，不是模型心情

是否追问，不应由 LLM“看起来觉得模糊”来决定。

应由产品定义：

- 哪些任务类型必须澄清
- 哪些槽位缺失时必须澄清
- 哪些信息可以采用默认值

### 原则

只问**会显著改变执行路径**的问题。

例如通常值得问：

- 这是新建任务还是修改当前任务
- 页面范围 / 功能范围
- 是否需要后台 / CMS / 登录
- 设计风格中会影响实现结构的关键约束

而通常不必问：

- 可以安全默认的工程细节
- 不影响第一轮执行方向的低价值偏好

---

## P6. 高歧义、高分支、高返工成本任务，应默认进入稳定澄清模式

像下面这类输入：

- “做一个 Apple 风格的博客网站”
- “帮我做一个项目管理系统”
- “做一个 SaaS 官网”

都属于：

- 高层目标
- 约束不足
- 分支很多
- 一旦默认错了，返工成本高

对这类任务，不应让系统随机决定“问不问”。

### 默认策略

当输入符合这类模式时，应优先进入 clarification gate，并稳定追问关键槽位，例如：

- 页面 / 功能范围
- 内容结构
- 视觉方向
- 是否需要管理后台或数据系统

---

## P7. 显式状态优先于隐式记忆

任何会影响产品路由的上下文，都必须尽量显式。

包括但不限于：

- active session
- live session
- current spec
- current nodes
- pending clarification
- resumable session identity

### 禁止事项

避免让旧 checkpoint、全局状态、隐式历史记录在用户无感知的情况下参与关键路由判断。

尤其不能让：

- 全局 checkpoint 悄悄影响 new run / clarification 判断
- 历史 session 的上下文污染当前显式任务

---

## P8. 多 session 心智优先于单对话连续性

Shipyard 的核心不是“一条无限延长的聊天记录”，而是“多个可切换、可恢复、可回看的任务 session”。

因此：

- session 边界要比 chat 连续性更重要
- 用户当前在看哪个 session，必须是明确的
- 历史 session 与 live session 必须区分
- 新任务、修改任务、恢复任务应是不同的产品动作

---

## P9. LLM 负责理解与表达，不负责拍板产品状态机

LLM 很适合做：

- 意图理解辅助
- spec 结构化
- clarification 问题生成
- 答案总结
- 文案润色

LLM 不适合单独决定：

- 是否进入哪条控制流
- 是否沿用旧上下文
- 是否跳过澄清
- 是否改变 session 归属

一句话总结：

> 用户可见的关键行为，必须由稳定状态机驱动；LLM 只负责理解与表达，不负责拍板控制流。

---

## 3. 产品对象模型

Shipyard 的核心对象应稳定围绕以下四类实体：

### 3.1 Project

项目容器，承载多个 session。

### 3.2 Session

一次独立任务执行上下文，包含：

- 原始输入
- spec / clarified spec
- graph
- logs
- files
- run status
- resume 信息

### 3.3 Intent

用户这次输入对应的动作类型，例如：

- new_session
- modify_session
- resume_session
- retry_node
- status

### 3.4 Execution

具体执行态，例如：

- idle
- clarifying
- planning
- running
- paused
- failed
- done

---

## 4. 推荐的产品控制流

建议将 Chat 输入后的处理拆为三层：

## 4.1 Intent Router

输入：

- raw user message
- explicit active session
- explicit current context

输出：

- new_session
- modify_session
- resume_session
- retry_node
- status

要求：

- 高稳定性
- 强可解释性
- 尽量不依赖隐式历史

## 4.2 Clarification Policy Engine

职责：

- 判断是否缺少关键槽位
- 决定是否进入 clarification gate
- 决定问哪些问题

要求：

- rule-first
- LLM 用于生成问题文案，不负责决定 policy

## 4.3 Execution Spec Builder

在 intent 与 clarification 明确之后，再把：

- raw message
- clarified answers
- selected session context

整合成最终执行用 spec。

这一步允许 LLM 做更强的结构化与润色。

---

## 5. 当前实现上的直接指导

在修改 `apps/web/src/features/chat/*`、`apps/server/src/routes/chat.ts`、`apps/server/src/routes/clarify.ts`、`useSession`、`runController` 等代码时，应遵守以下直接约束：

1. 不要把“是否弹 clarification card”设计成纯 LLM 随机结果
2. `/chat` 不应既负责意图识别，又隐式决定所有后续产品动作
3. clarification 判断应尽量直接基于原始用户输入，而不是先被改写过的 spec
4. 不要让旧 checkpoint / 全局运行态悄悄污染新任务路由
5. session 归属必须显式，不可猜测
6. 相同输入在相同上下文下，应可复现相同结果

---

## 6. 文档使用方式

当以下内容发生冲突时，优先级建议如下：

1. 用户明确产品目标 / 产品约束
2. 本文档的产品第一性原则
3. 当前阶段的重构计划文档
4. 局部实现便利性

如果某段代码“实现起来更省事”，但违反了这里的原则，应优先修正设计，而不是继续叠加补丁。
