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

### 分层 Agent 协作

```
Planner Agent（Opus）    → 理解 spec，生成执行图，不写代码
Implementer Agent（Sonnet）→ 执行单个节点，只知道自己的任务
Verifier              → 确定性验证（tsc）+ spec-derived 行为验证
```

每个 Implementer Agent 的 context 是隔离的——它只看到自己的任务描述和依赖节点的接口，不会被整个项目的信息污染。

---

## 架构

```
shipyard/
├── src/
│   ├── graph.ts       核心数据结构：ExecutionGraph、GraphNode、状态机、Evidence
│   ├── verify.ts      验证系统：tsc 编译检查 + spec-derived 行为验证
│   ├── shipyard.ts    调度引擎：buildGraph → executeNode → verifyNode → transitionNode
│   ├── prompts.ts     System prompts：Planner、Implementer、Reviewer
│   ├── hooks.ts       Agent hooks：路径安全、审计日志、进度输出
│   ├── config.ts      配置：模型路由、重试次数、工作目录
│   └── index.ts       CLI 入口
└── output/            生成的代码文件
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
npm install
```

### 配置

```bash
# 必须
export ANTHROPIC_API_KEY=sk-xxx

# 可选：使用中转服务（支持任何 OpenAI 兼容格式）
export ANTHROPIC_BASE_URL=https://your-proxy.com/v1

# 可选：自定义模型路由
export MODEL_PLANNING=claude-opus-4-5        # 规划阶段（默认）
export MODEL_IMPLEMENTATION=claude-sonnet-4-5 # 实现阶段（默认）
export MODEL_REVIEW=claude-haiku-4-5          # review 阶段（默认）
```

### 运行

```bash
npx ts-node src/index.ts "实现用户登录：接收 email 和 password，密码错误返回 INVALID_CREDENTIALS，成功返回 JWT token，24小时过期"
```

### 输出示例

```
🚢 Shipyard v0.3
📋 Spec: 实现用户登录...
🤖 plan=claude-opus-4-5 | impl=claude-sonnet-4-5

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

Shipyard 基于 [Claude Agent SDK](https://code.claude.com/docs/en/sdk)，直接使用 Anthropic 官方的 agent harness。不引入额外的 agent 框架，原因：

- 减少抽象层，每层都可控
- Claude Agent SDK 已经处理了 tool execution、context 管理、错误重试
- 你的业务逻辑（图调度、验证、evidence 收集）不应该被框架约束

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
- [ ] WebSocket 实时推送图状态

### v1.0（目标）

- [ ] IDE 界面：文件树 + 任务画板（DAG 可视化）+ CLI 聊天
- [ ] 人工介入节点（checkpoint node）
- [ ] 多项目并行管理
- [ ] 成本追踪与预算控制

---

## 核心文件说明

### `graph.ts`

定义了整个系统的数据模型。如果你想理解 Shipyard 的设计，从这里开始。

关键类型：`ExecutionGraph`、`GraphNode`、`Evidence`、`VerificationCriterion`

关键函数：`createGraph`、`addNode`、`transitionNode`、`getReadyNodes`、`buildHistory`

### `verify.ts`

验证系统的实现。两层：
1. `runCompileCheck` — tsc 编译，确定性，0/1
2. `extractVerificationCriteria` + `runBehaviorVerification` — 从 spec 提取并运行行为验证

### `shipyard.ts`

调度引擎。`run()` 是主入口，内部循环：找就绪节点 → 并行执行 → 验证 → 推进状态。

### `hooks.ts`

Agent 生命周期 hook。`makePathGuard` 防止越权写文件，`auditLog` 记录所有写操作，`progressLog` 实时输出进度。

---

## License

MIT
