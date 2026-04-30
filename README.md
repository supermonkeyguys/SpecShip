# Shipyard

> 输入 spec，AI 自主开发，每一步都有据可查。

Shipyard 是一个基于执行图的 AI 开发引擎。它不是一个聊天助手，也不是一个代码补全工具——它是一个可以接收需求、自主拆解任务、并行执行、逐步验证、完整记录过程的自动化开发系统。

核心设计原则：**系统够硬，能兜底**。每个节点原子执行，每次操作留有 evidence，验证标准从 spec 自动派生，失败可追溯、可重试、不丢工作。

---

## 核心概念

### 执行图（Execution Graph）

整个开发过程被建模为一个有向无环图：

```
spec
 │
 ▼
[plan node] → 解析 spec，生成执行图
 │
 ├─▶ [impl-types]  ──────────────────────────────▶ [integrate]
 │                                                      ▲
 ├─▶ [impl-auth]   ─── dependsOn: impl-types ──────────┤
 │                                                      │
 └─▶ [impl-user]   ─── dependsOn: impl-types ──────────┘
```

每个节点（Node）包含：

| 字段 | 含义 |
|------|------|
| `specFragment` | 对应 spec 的哪段需求 |
| `status` | 状态机：pending → ready → running → verifying → done/failed |
| `evidence` | 完整执行记录：tool calls、写入文件、验证结果、推理过程 |
| `dependsOn` | 依赖的节点 ID，决定并行调度顺序 |

### Spec-derived 验证

验证标准不是人工写的，而是从 spec 自动提取的：

```
spec: "密码错误时返回 INVALID_CREDENTIALS 错误"
         ↓ 自动提取
验证: login('a@b.com', 'wrongpass') → throws { code: "INVALID_CREDENTIALS" }
         ↓ 生成临时测试文件并运行
结果: ✅ PASS  /  ❌ FAIL + 具体原因
```

每个节点执行完成后，先跑 tsc 编译检查，再跑从 spec 派生的行为验证，两者都通过才标记为 `done`。

### 分层 Agent 协作（OpenAI-compatible tool loop）

```
Planner LLM（planning model）      → 理解 spec，生成执行图 JSON（不执行工具）
Implementer LLM（implementation model）→ 通过 OpenAI-compatible tool loop 调用 write_file/read_file/run_command
Verifier                           → 确定性验证（tsc）+ spec-derived 行为验证
```

当前实现不依赖 Claude Agent SDK 执行链。工具调用循环由 `packages/core/src/ai/llm.ts` 内的 `runAgent()` 自行实现：
- 请求 `/chat/completions`
- 读取 `tool_calls`
- 本地执行工具
- 将 tool 结果回填到 messages
- 直到 `finish_reason=stop`

每个 Implementer 节点的 context 是隔离的——它只看到自己的任务描述和依赖节点的接口，不会被整个项目的信息污染。

### Planner prompt 来源

规划阶段使用 `packages/core/src/ai/prompts.ts` 中的 `GRAPH_PLANNER_PROMPT`，`buildGraph()` 会直接把它传给 `runAgent(..., withTools=false)` 来生成可解析的计划 JSON。
`shipyard.ts` 只负责调用，不再维护重复的 planner prompt 常量。

---

## 架构

```
shipyard/
├── apps/
│   ├── cli/src/index.ts        CLI 入口
│   ├── server/src/             Express API + SSE + session/project routes
│   └── web/                    Vite + React IDE
├── packages/
│   ├── core/src/               graph / orchestrator / ai / verification / persistence
│   ├── shared/src/types.ts     前后端共享 contract
│   └── orchestrator-temporal/  Temporal 编排层
├── .shipyard/                  project/session 数据
└── output/                     CLI 生成的代码文件
```

### 数据流

```
用户输入 spec
    │
    ▼
buildGraph()           ← Planner Agent 解析 spec，生成节点 DAG
    │
    ▼
调度循环
    ├─ getReadyNodes()  ← 找出依赖已满足的节点
    ├─ executeNode()    ← Implementer Agent 写代码，收集 evidence
    ├─ verifyNode()     ← tsc + spec-derived 测试
    └─ transitionNode() ← 推进状态，失败时自动阻塞下游
    │
    ▼
ExecutionGraph         ← 完整的执行历史，保存为 .shipyard-graph.json
    │
    ▼
buildHistory()         ← 人类可读的开发历史
```

---

## 快速开始

### 安装

```bash
git clone <repo>
cd shipyard
pnpm install
```

### 配置

```bash
# 必须（两套变量名都支持，优先 OPENAI_*）
export OPENAI_API_KEY=sk-xxx
# 或
export ANTHROPIC_API_KEY=sk-xxx

# 可选：使用中转服务（支持任何 OpenAI 兼容格式）
export OPENAI_BASE_URL=https://your-proxy.com/v1
# 或
export ANTHROPIC_BASE_URL=https://your-proxy.com/v1

# 可选：自定义模型路由（默认 gpt-5.1）
export MODEL_PLANNING=gpt-5.1
export MODEL_IMPLEMENTATION=gpt-5.1
export MODEL_REVIEW=gpt-5.1
```

说明：运行时请求的是 OpenAI-compatible `/chat/completions` 接口，`baseURL` 默认值为 `https://api.openai.com/v1`。
如果你使用 Anthropic 网关，也需要提供 OpenAI 兼容格式的转发地址。

### 运行

```bash
# 默认模式：每次运行前清空 output/
pnpm start -- "实现用户登录：接收 email 和 password，密码错误返回 INVALID_CREDENTIALS，成功返回 JWT token，24小时过期"

# resume 模式：从 checkpoint 继续；若传入新 spec 会被忽略
pnpm start -- --resume
```

### output 与 resume 行为

- 默认模式（不带 `--resume`）：启动时会清空 `output/` 后再执行。
- resume 模式（带 `--resume`）：不会清空 `output/`，会保留现有文件并继续执行流程。

### 输出示例

```
🚢 Shipyard v0.3
📋 Spec: 实现用户登录...
🤖 plan=gpt-5.1 | impl=gpt-5.1

[PLANNING] Building execution graph...
  ℹ️  Assumptions:
     • Using mock JWT generation (no external library)
  → 3 nodes in execution graph
     impl-types (parallel start)
     impl-auth (after: impl-types)
     test-login (after: impl-auth)

[EXECUTING] Starting parallel agent dispatch
  ▶ [impl-types] Define types
  → Write: output/types.ts
  ✅ [impl-types] All 2 check(s) passed
  ▶ [impl-auth] Implement login function
  → Write: output/auth.ts
    ✅ login returns token on success
    ✅ login throws INVALID_CREDENTIALS on wrong password
  ✅ [impl-auth] All 3 check(s) passed
  ▶ [test-login] Write tests
  → Write: output/auth.test.ts
  ✅ [test-login] All 2 check(s) passed

═══════════════════════════════════════════════════════
✅ DONE in 18.4s

📊 Nodes: 3 done, 0 failed, 0 blocked
   Verifications: 7/7 passed
   Files: 3 generated

📁 Generated files:
   📄 output/types.ts (312b)
   📄 output/auth.ts (1842b)
   📄 output/auth.test.ts (956b)

📜 Execution history:
   1. ✅ Define types
      Spec: "实现用户登录：接收 email 和 password..."
      Files: output/types.ts
      ✓ [compile] 1 file(s) compiled
      Time: 4.2s

   2. ✅ Implement login function
      Spec: "密码错误返回 INVALID_CREDENTIALS，成功返回 JWT token"
      Files: output/auth.ts
      ✓ [compile] 1 file(s) compiled
      ✓ [test] login returns token on success
      ✓ [test] login throws INVALID_CREDENTIALS on wrong password
      Time: 8.1s

💾 Graph saved to .shipyard-graph.json
```

---

## 设计决策

### 为什么不用 LangChain / AutoGen

Shipyard 当前使用自实现的 OpenAI-compatible tool loop（`packages/core/src/ai/llm.ts`），不依赖 Claude Agent SDK 执行链，也不引入 LangChain/AutoGen。

原因：

- 减少抽象层，每层都可控
- tool execution、消息回填、循环终止条件都由项目内代码明确控制
- 业务逻辑（图调度、验证、evidence 收集）不被外部 agent 框架约束

### 为什么用执行图而不是线性流水线

线性流水线（step 1 → step 2 → step 3）无法并行，且一个步骤失败会阻塞所有后续步骤。

执行图允许：
- 无依赖的节点并行执行
- 失败隔离：一个节点失败只阻塞它的下游，不影响其他分支
- 完整的历史记录：图的每个节点都保存了执行 evidence

### 为什么验证标准从 spec 派生

手写测试的问题：测试可能和 spec 不一致，测试通过不代表需求满足。

从 spec 派生验证标准，保证了：**验证的是 spec 描述的行为，而不是实现的行为**。这是 Shipyard 和现有 AI 代码生成工具最核心的差异。

---

## 当前状态与路线图

### v0.3（当前）

- [x] 执行图数据结构（graph.ts）
- [x] Spec-derived 验证（verify.ts）
- [x] 多 Agent 并行调度
- [x] Evidence 收集与历史记录
- [x] 状态机保证不可逆推进
- [x] 失败隔离与自动重试

### v0.4（下一步）

- [ ] 接入已有 Git 仓库（读懂存量代码再规划）
- [ ] Checkpoint 持久化（中断后从断点继续）
- [ ] SSE 实时推送图状态

### v1.0（目标）

- [ ] IDE 界面：文件树 + 任务画板（DAG 可视化）+ CLI 聊天
- [ ] 人工介入节点（checkpoint node）
- [ ] 多项目并行管理
- [ ] 成本追踪与预算控制

---

## 核心文件说明

### `packages/core/src/graph/graph.ts`

定义整个系统的核心数据模型。如果你想理解 Shipyard 的执行图设计，从这里开始。

关键类型：`ExecutionGraph`、`GraphNode`、`Evidence`、`VerificationCriterion`

### `packages/core/src/verification/verify.ts`

验证系统实现：
1. `runCompileCheck` — TypeScript 编译检查
2. `extractVerificationCriteria` + `runBehaviorVerification` — 从 spec 提取并运行行为验证
3. `runLintCheck` — 项目存在 lint 配置时做软校验

### `packages/core/src/orchestrator/shipyard.ts`

主调度引擎。`run()` 是核心入口，负责：找就绪节点 → 执行节点 → 验证 → 推进状态 → checkpoint。

### `packages/core/src/ai/hooks.ts`

执行过程中与工具/文件系统相关的辅助逻辑，例如路径安全校验与写入审计。

---

## License

MIT
