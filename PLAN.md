# Shipyard — 产品计划大纲

## 产品定位

一个**可观测的 AI 开发 IDE**。

用户输入 spec 或导入已有仓库，AI 自主拆解任务、并行执行、逐步验证，整个过程在画板上实时可见，人可以随时介入。

核心差异：不是黑盒自动化（Devin），不是交互式辅助（Cursor）。
是**透明的、可信赖的、人主导方向的 AI 开发流程**。

---

## 当前状态（v0.4，2026-04-28 更新）

### 已完成的核心能力

**引擎层（packages/core/src/）**
- 执行图数据结构（graph.ts）
- OpenAI 兼容 LLM 客户端，/responses + /chat/completions 双端点，自动 fallback，SSE 流解析（llm.ts）
- Spec-derived 行为验证（verify.ts）
- 多 agent 并行调度，失败隔离，重试机制（shipyard.ts）
- Evidence 完整记录（tool calls、文件 checksum、验证结果）
- AgentRunner / NodeVerifier 注入接口（供测试和 Temporal Activity 使用）

**AI 流 bug 修复（2026-04-28）**
- Planner dependsOn 死锁：构建图前校验所有 id 存在
- blockDownstream 漏 ready 节点：条件加入 `|| node.status === "ready"`
- 重试旧文件残留：executeNode 开头清理旧文件
- Agent Loop 截断无告警：15 轮后加 warn
- 依赖注入截断 600→2000 字符
- Reviewer 失败原因不传 Implementer：runCodeReview 返回 blockingIssues 注入 lastError
- testCase.input 代码注入：SAFE_INPUT_PATTERN 白名单正则
- blocked 绕过状态机：VALID_TRANSITIONS.blocked = ["pending"]，改用 transitionNode

**服务层（apps/server/）**
- Express + SSE server，多路由（run/resume/retry/clarify/chat/stream/files/projects）
- SSE 历史回放（刷新不丢状态）
- 实时节点状态推送（diff 推送）
- ClarificationCard 完整功能（结构化澄清问题，AI 判断 options/free 模式）
- ORCHESTRATOR_MODE 环境变量切换 legacy/temporal 路径

**前端（apps/web/）**
- 三栏 IDE：React Flow 画板 + 文件树 + 聊天框
- ClarificationCard 组件（选项卡 + 自由输入 + 已回答锁定摘要）

**Temporal 迁移（packages/orchestrator-temporal/，2026-04-28）**
- Phase 0：回归测试基线（15 条，零 LLM，AgentRunner/NodeVerifier 注入）
- Phase 1：Temporal SDK 1.16.1 + Workflow/Activity 骨架
- Phase 2：真实 core 逻辑接入（buildGraph/executeNode/verify/review）
- Phase 3：DAG 并发调度（Promise.race 主循环）+ Signal（retryNode/skipNode/cancelRun）+ SSE projection 适配
- Phase 4：Worker 脚本 + 双跑验证 + 真实 Temporal server 端到端验证通过

---

## Temporal 迁移现状

### 已完成
- `packages/orchestrator-temporal/` 完整实现
- `ORCHESTRATOR_MODE=temporal` 启动 Temporal 路径
- `ORCHESTRATOR_MODE=legacy`（默认）保持原有行为不变
- 21 条测试全绿（smoke × 3，signal × 2，dualrun × 1，core regression × 15）

### Temporal 路由接入状态（已完成）
- `POST /api/resume`：Temporal 模式已接入 Query + `resumeRun` Signal
- `POST /api/node/:id/retry`：Temporal 模式已接入 `retryNode` Signal
- `GET /api/status`：Temporal 模式已改为 Query `getRunSummary`

### 启动方式（Temporal 路径）
```bash
# Terminal 1
temporal server start-dev

# Terminal 2
OPENAI_API_KEY=sk-xxx OPENAI_BASE_URL=https://... pnpm temporal:worker

# Terminal 3
ORCHESTRATOR_MODE=temporal OPENAI_API_KEY=sk-xxx pnpm server:dev
```

详见：`docs/temporal-phase4-runbook.md`

---

## 项目结构（monorepo）

```
packages/
  core/                     引擎（graph/llm/verify/shipyard/checkpoint/prompts）
  orchestrator-temporal/    Temporal 编排层（workflow/activities/worker/client）
  shared/                   前后端共享类型
apps/
  server/                   Express API server
  web/                      React 前端（Vite）
  cli/                      CLI 入口
test/
  regression/               回归测试（run-basic/retry/resume/manual-retry）
docs/
  temporal-phase4-runbook.md  Temporal 操作手册
  superpowers/specs/          设计文档
  superpowers/plans/          实现计划
```

---

## 当前阶段收口结果（2026-04-29）

### 1. Temporal 路由补全（已完成）

**resume 路由**（`apps/server/src/routes/resume.ts`）：
- `POST /api/resume`：Temporal 模式已接入 `resumeRun` Signal
- `GET /api/status`：Temporal 模式已改为 Query `getRunSummary`

**retry 路由**（`apps/server/src/routes/node.ts`）：
- `POST /api/node/:id/retry`：Temporal 模式已改为 `retryNode(nodeId)` Signal
- server 已维护 `activeWorkflowId`（与 `activeSession` 配合）

### 2. 前端功能补全（已完成）

- Canvas 节点图：节点 running 状态脉冲动画 ✅
- 文件树：点击预览文件内容 ✅
- 日志 tab：显示 tool call 详情 ✅

### 3. 多设备注意事项（保持不变）

- `.gitattributes` 已配置 LF 换行，Windows 设备 git clone 后直接可用
- Temporal CLI：macOS `brew install temporal`，Windows `winget install Temporal.TemporalCLI`
- 首次运行 `@temporalio/testing` 会下载 ephemeral server 二进制（~30MB，需要网络）

---

## 关键设计原则（不能违背）

1. **引擎和 UI 分离**：`packages/core/` 是纯 Node.js，零 UI 依赖。
2. **每个节点原子执行**：要么完整完成，要么完整回滚。
3. **Evidence 不可篡改**：节点执行记录只能追加，不能修改。
4. **验证先于交付**：没有通过验证的节点不能标记为 done。
5. **人主导方向，AI 执行细节**：checkpoint 节点保证关键决策经过人确认。
6. **Workflow 无副作用**：Temporal Workflow 代码不做任何 IO/网络/文件操作，全部下沉到 Activity。

---

## 给下一个 Agent 的上下文

### 必读：加载项目技能
```
Use the Skill tool to load: shipyard-dev
```

### 项目位置
```
/Users/cookie/project/shipyard/
```

### 核心文件索引
```
packages/core/src/graph.ts          所有类型定义（先读这里）
packages/core/src/shipyard.ts       主调度引擎，run() 入口，buildGraph/executeNode/runCodeReview 已 export
packages/core/src/llm.ts            LLM 客户端，AgentRunner 类型
packages/core/src/verify.ts         验证层，NodeVerifier 类型
packages/core/src/prompts.ts        所有 system prompts（CLARIFIER_PROMPT 已更新为结构化输出）

packages/orchestrator-temporal/src/
  workflows/spec-run.workflow.ts    SpecRunWorkflow（DAG 并发调度 + Signal/Query）
  activities/spec-run.activities.ts  Activities（planGraph/executeNode/persistGraph/notifyNodeUpdate）
  worker/worker.ts                  Worker 启动入口
  client/run-workflow.ts            Client 封装（server 层调用此文件）

apps/server/src/routes/
  run.ts      POST /api/run（ORCHESTRATOR_MODE 切换）
  resume.ts   POST /api/resume（Temporal 已接入 resumeRun Signal）
  node.ts     POST /api/node/:id/retry（Temporal 已接入 retryNode Signal）

test/regression/helpers.ts          测试工具（makeMockAgentRunner/makeMockNodeVerifier/makeTestConfig）
```

### 运行测试
```bash
pnpm test                    # 全量（15 条 core + Temporal smoke/signal/dualrun）
TEMPORAL_LIVE_TEST=1 node --require tsx/cjs --test packages/orchestrator-temporal/test/phase4-live.test.ts
```

### 运行服务（legacy 模式，无需 Temporal）
```bash
OPENAI_API_KEY=sk-xxx OPENAI_BASE_URL=https://aicodelink.top/v1 pnpm server:dev
pnpm web:dev
```

### 已知 LLM 代理兼容性
- 代理 `/chat/completions` 返回 SSE 流格式（不是标准 JSON）
- `llm.ts` 已处理：检测 `content-type: text/event-stream` 或 `data:` 前缀，走 `assembleFromSseChunks`
- 环境变量 `FORCE_CHAT_COMPLETIONS=1` 可跳过 `/responses` 端点直接用 `/chat/completions`
