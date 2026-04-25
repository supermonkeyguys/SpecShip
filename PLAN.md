# Shipyard — 产品计划大纲

## 产品定位

一个**可观测的 AI 开发 IDE**。

用户输入 spec 或导入已有仓库，AI 自主拆解任务、并行执行、逐步验证，整个过程在画板上实时可见，人可以随时介入。

核心差异：不是黑盒自动化（Devin），不是交互式辅助（Cursor）。
是**透明的、可信赖的、人主导方向的 AI 开发流程**。

---

## 当前状态（v0.3，已完成）

- 执行图数据结构（graph.ts）
- OpenAI 兼容 LLM 客户端，支持任意中转（llm.ts）
- Spec-derived 行为验证（verify.ts）
- 多 agent 并行调度，失败隔离，重试机制
- Evidence 完整记录（tool calls、文件 checksum、验证结果）
- CLI 入口，输出执行历史
- 已端到端跑通

---

## 阶段规划

### Phase 1 — 引擎稳固（v0.4）

目标：让引擎在各种 spec 下都能可靠运行，为 UI 层提供稳定的数据基础。

**1.1 Checkpoint 持久化**
- 每个节点完成后写 checkpoint 到 `.shipyard/checkpoints/`
- 启动时检测未完成的 graph，从断点恢复
- 实现原子写（tmp + rename），防止写到一半崩溃
- 关键文件：`src/checkpoint.ts`

**1.2 已有仓库接入**
- 接受 `--repo <path>` 参数
- 启动时读取仓库结构（文件树、package.json、主要入口）
- 将仓库上下文注入 Planner prompt，让规划基于现有代码
- 关键挑战：context 大小控制，只注入相关文件

**1.3 验证系统加固**
- 当前行为验证依赖 LLM 提取测试用例，质量不稳定
- 加入：如果生成了测试文件（`*.test.ts`），直接运行它
- 加入：lint 检查（eslint）
- 区分"硬性失败"（编译错误）和"软性失败"（行为不符）

**1.4 错误恢复策略**
- compile_error：把 tsc 错误注入 prompt 重试
- logic_error：触发重新规划（不只是重试当前节点）
- api_error：指数退避重试

---

### Phase 2 — 实时可观测（v0.5）

目标：把引擎的内部状态暴露出来，让 UI 能订阅。

**2.1 WebSocket 状态推送**
- 启动一个本地 WebSocket server（端口 7700）
- 每次 `transitionNode` 后推送图状态变更
- 消息格式：`{ type: "node_update", nodeId, status, evidence? }`
- 关键文件：`src/server.ts`

**2.2 REST API**
```
GET  /api/graph          → 当前执行图完整状态
GET  /api/graph/history  → buildHistory() 结果
POST /api/run            → 启动新任务
POST /api/pause          → 暂停当前执行
POST /api/node/:id/retry → 手动重试某个节点
POST /api/node/:id/skip  → 跳过某个节点
```

**2.3 文件系统监听**
- 监听 `output/` 目录变化
- 文件变更时推送 `file_changed` 事件
- 供左侧文件树实时更新

---

### Phase 3 — IDE 界面（v1.0）

目标：实现你描述的三栏 IDE 布局。

```
┌──────────────┬──────────────────────────────┬──────────────┐
│  左：文件树  │      中：任务画板             │  右：聊天框  │
└──────────────┴──────────────────────────────┴──────────────┘
```

**3.1 左侧：项目文件树**
- 展示 `output/` 和仓库文件
- 文件状态着色：生成中（蓝）/ 完成（绿）/ 失败（红）
- 点击文件预览内容
- 技术选型：Electron + React，或 Web（Vite + React）

**3.2 中间：任务画板**
- 每个 GraphNode 渲染为一个 Card
  - 标题、状态图标、specFragment 摘要
  - 展开后：evidence 详情、验证结果、文件列表
- 节点间用虚线连接（依赖关系）
- 状态实时更新（WebSocket 驱动）
- 颜色编码：pending（灰）/ running（蓝动画）/ done（绿）/ failed（红）
- 技术选型：React Flow（节点图渲染库）

**3.3 右侧：CLI 风格聊天框**
- 输入框：接收 spec 或指令
- 指令系统：
  ```
  > run "实现登录功能"     → 启动新任务
  > pause                  → 暂停执行
  > retry impl-auth        → 重试指定节点
  > skip test-auth         → 跳过指定节点
  > status                 → 显示当前图状态
  > history                → 显示执行历史
  ```
- 实时输出：agent 的每个操作滚动显示（类似 Claude Code 的输出）
- 技术选型：xterm.js 或自定义 terminal 组件

**3.4 Checkpoint 节点（人工确认点）**
- Planner 可以在关键决策前插入 `checkpoint` 类型节点
- 执行到 checkpoint 时暂停，右侧显示"等待确认"
- 用户在聊天框输入 `approve` / `reject + 修改意见`
- reject 时重新规划该分支

---

### Phase 4 — 生产化（v1.x）

**4.1 Git 集成**
- 自动在隔离 branch 上工作（`shipyard/task-xxx`）
- 完成后生成 PR，包含：执行历史、验证报告、文件 diff
- 支持从 GitHub Issue / Linear ticket 直接启动任务

**4.2 多项目管理**
- 项目列表：多个 spec/仓库并行管理
- 每个项目独立的 graph 和 checkpoint
- 跨项目的执行历史和成本统计

**4.3 成本控制**
- 每次 LLM 调用记录 token 消耗
- 任务级别的成本上限（超出则暂停等待确认）
- 模型路由优化：简单节点用便宜模型，规划用强模型

**4.4 分层 Agent 协作（完整版）**
- 当前：Planner → 多个 Implementer（两层）
- 目标：Planner → Module Manager → Implementer（三层）
- Module Manager 负责模块内的文件级拆分
- 每层 agent context 完全隔离

---

## 技术栈决策

| 层 | 当前 | 目标 |
|---|---|---|
| 引擎 | TypeScript + Node.js | 保持 |
| LLM 接入 | OpenAI 兼容 fetch | 保持，支持多 provider |
| 状态推送 | 无 | WebSocket (ws 库) |
| UI 框架 | 无 | Electron + React + Vite |
| 节点图渲染 | 无 | React Flow |
| 终端组件 | 无 | xterm.js |

---

## 关键设计原则（不能违背）

1. **引擎和 UI 分离**：引擎是纯 Node.js，不依赖任何 UI 框架。UI 通过 WebSocket/REST 消费引擎状态。

2. **每个节点原子执行**：要么完整完成，要么完整回滚。不存在"写了一半"的状态。

3. **Evidence 不可篡改**：节点的执行记录只能追加，不能修改。这是"开发历史"可信赖的基础。

4. **验证先于交付**：没有通过验证的节点不能标记为 done。验证标准从 spec 派生，不是人工写的。

5. **人主导方向，AI 执行细节**：checkpoint 节点保证关键决策经过人确认。AI 不能自主做影响整体架构的决定。

---

## 给下一个 Agent 的上下文

### 项目位置
```
/Users/cookie/project/shipyard/
```

### 核心文件
```
src/graph.ts      执行图数据结构，所有类型定义在这里
src/llm.ts        OpenAI 兼容 agent loop，tool use 实现
src/verify.ts     spec-derived 验证，两层：编译 + 行为
src/shipyard.ts   主调度引擎，run() 是入口
src/config.ts     配置，读环境变量
src/prompts.ts    所有 system prompts
```

### 运行方式
```bash
OPENAI_BASE_URL=https://aicodelink.top/v1 \
OPENAI_API_KEY=sk-xxx \
MODEL_PLANNING=gpt-5.4 \
MODEL_IMPLEMENTATION=gpt-5.4 \
npx ts-node src/index.ts "你的 spec"
```

### 已知问题 / 待改进
- 行为验证的测试文件生成逻辑较脆弱（依赖函数名匹配）
- Planner 有时把 dependsOn 写成文件路径而不是节点 id（已有兼容处理）
- 没有 checkpoint 持久化，中断后从头开始
- 验证系统还不能运行生成的 `*.test.ts` 文件

### 下一步优先做
Phase 1.1（Checkpoint 持久化）和 Phase 1.3（验证加固）是最高优先级，
这两个做完引擎才算真正可靠，之后再做 UI 层。
