# Shipyard Frontend Refactor Plan

> 目标：把当前 `apps/web` 从“可工作的单页原型”升级为“可持续演进的对外产品前端”。
>
> 这份文档强调：
> - 可执行
> - 可跟踪进度
> - 可交接给不同 AI / 工程师并行推进
> - 尽量降低一次性重构风险

---

## 0. 背景与结论

### 当前产品定位
- 对外产品
- 功能优先
- 桌面优先
- 暂不考虑移动端
- 多 session 心智

### 当前前端核心问题

通过代码审查与前端架构分析，当前问题主要不是“UI 组件太少”，而是：

1. **执行态没有 session 边界**
   - `graph store` 只有一份全局状态
   - 历史 session 与实时运行态写进同一容器

2. **Chat 同时承担 UI + orchestration**
   - `Chat.tsx` 直接编排 `/chat`、`/clarify`、`/run`、`/resume`、`/retry`
   - 新 run 创建后，前端没有显式接回 active session

3. **历史快照与实时事件混用**
   - `useSession` 通过 `applySSEEvent()` 回放历史快照
   - 语义不清，扩展困难

4. **运行生命周期不是单一真相**
   - `loading` 和 `runStatus` 语义混杂
   - 顶栏状态、右侧运行态提示可能不一致

5. **多 session 心智尚未真正落地**
   - 可以切 session，但核心状态模型仍偏单 session

---

## 1. 重构目标

### 产品目标
- 支持“多 session 浏览/切换”的稳定体验
- 保证“单 live run + 多历史 session”场景下状态正确
- 保持桌面工作台体验，减少状态错乱/视图跳变

### 工程目标
- 明确状态所有权
- 降低跨 feature 耦合
- 建立可测试的 orchestration 层
- 支持不同 AI / 工程师分阶段推进
- 支持中途可停、可继续、可回滚

### 非目标（本轮不做）
- 全量移动端适配
- 全量视觉重设计
- 全量后端协议推翻重做
- 一次性引入复杂状态库替换 Zustand

---

## 2. 总体设计原则

### P1. Session-aware first
任何 execution / graph / logs / file preview 状态，都必须能回答：

- 它属于哪个 `projectId`
- 它属于哪个 `sessionId`
- 它是实时态还是历史态

### P2. Snapshot 与 Event 分离
不能再用“伪造 SSE 事件”的方式做历史 hydration。

必须明确区分：
- 历史快照加载：`replaceSessionSnapshot(...)`
- 实时事件应用：`applyRealtimeEvent(...)`

### P3. UI 与 orchestration 分离
组件负责：
- 展示
- 用户输入
- 调用控制器

控制器负责：
- API 编排
- 生命周期推进
- session 交接
- 错误/回退策略

### P4. 单一真相
对同一件业务事实，尽量只有一个状态来源。

例如：
- “当前活跃 session” 只能有一个归属
- “任务运行状态” 只能有一套领域定义
- “当前文件预览目标” 只能有一份 identity

### P5. 渐进迁移
不做一次性大重写。

策略：
- 新建 domain 层与 store
- 旧代码先 bridge 兼容
- 逐步替换 feature 接入
- 每阶段都可运行/验证

---

## 3. 目标目录结构

建议逐步收敛到如下结构：

```text
apps/web/src/
  app/
    AppShell.tsx
    layout/

  domains/
    workspace/
      types.ts
      store.ts
      selectors.ts
      controller.ts

    execution/
      types.ts
      store.ts
      selectors.ts
      reducer.ts
      stream.ts
      snapshot.ts
      runController.ts

    chat/
      types.ts
      controller.ts

    projects/
      types.ts
      queries.ts
      controller.ts

    files/
      types.ts
      controller.ts

  features/
    session/
      ProjectSidebar.tsx
      ResumeBar.tsx

    canvas/
      CanvasPanel.tsx
      NodeDetail.tsx

    chat/
      ChatPanel.tsx
      ChatView.tsx
      MessageList.tsx
      Composer.tsx
      LogPanel.tsx

    files/
      FilePreviewPanel.tsx

  shared/
    api/
      runClient.ts
      chatClient.ts
      projectClient.ts
      fileClient.ts
      sessionClient.ts
    ui/
      EmptyState.tsx
      LoadingState.tsx
      InlineError.tsx
      StatusPill.tsx
```

> 注意：本轮不要求一步到位完成所有目录迁移。
> 可以按阶段先建 `domains/*` 与 `shared/api/*`，再逐步迁组件。

---

## 4. 目标状态模型

## 4.1 Workspace 状态

负责表达“用户正在看哪里”。

```ts
export interface ActiveSessionRef {
  projectId: string;
  sessionId: string;
  spec?: string;
}

export interface WorkspaceState {
  activeSession: ActiveSessionRef | null;
  expandedProjectId: string | null;
  selectedFile: {
    projectId: string;
    sessionId: string;
    path: string;
  } | null;
  resumeInfo: StatusResponse | null;
}
```

### Workspace 负责
- 当前选中的 session
- 当前展开的 project
- 当前打开的文件 identity
- resume 提示条相关信息

### Workspace 不负责
- graph 节点详情数据
- SSE 实时事件流
- chat message 列表

---

## 4.2 Execution 状态

负责表达“某个 session 的执行投影”。

```ts
export type SessionRunStatus =
  | "idle"
  | "running"
  | "resuming"
  | "done"
  | "failed";

export interface SessionExecutionState {
  projectId: string;
  sessionId: string;
  nodes: Record<string, NodeStatus>;
  logs: string[];
  summary: GraphSummary | null;
  runStatus: SessionRunStatus;
  source: "snapshot" | "realtime";
  lastUpdatedAt: number | null;
}

export interface ExecutionState {
  sessions: Record<string, SessionExecutionState>;
  liveSessionId: string | null;
  streamStatus: "disconnected" | "connecting" | "connected" | "error";
}
```

### Execution 负责
- 每个 session 的 graph / logs / summary / runStatus
- 当前 live session
- SSE 连接状态

### Execution 不负责
- 当前 UI 展开哪个 project
- 当前选中了哪个文件
- 聊天输入框文本

---

## 4.3 Chat 状态

```ts
export interface ChatMessage {
  role: "user" | "ai" | "system";
  text: string;
  createdAt: number;
}

export interface PendingSpec {
  spec: string;
  repoPath?: string;
}

export interface ChatState {
  messagesBySession: Record<string, ChatMessage[]>;
  draftBySession: Record<string, string>;
  pendingSpecBySession: Record<string, PendingSpec | null>;
  requestStateBySession: Record<string, "idle" | "thinking" | "submitting">;
}
```

> 若实现成本过高，可先做“只维护 active session 的 chat 状态”，但接口设计要预留 `messagesBySession`。

---

## 5. 协议建议（前后端 / shared）

## 5.1 最小前端闭环所需

后端若暂时不改，也可先做一版前端重构；但推荐尽早升级 SSE envelope。

### 当前问题
当前 SSE 事件没有明确 `projectId/sessionId` 归属。

### 推荐协议

```ts
export interface SessionSSEEvent<T = unknown> {
  projectId: string;
  sessionId: string;
  type: "node_update" | "graph_done" | "graph_failed" | "log";
  payload: T;
}
```

### 收益
- 前端可以把事件准确写入 `sessions[sessionId]`
- 才能稳定支持“我在看 A，但 B 正在跑”的场景

### 过渡方案
若后端暂时不改：
- 前端先假设 SSE 只属于 `liveSessionId`
- 历史 session 只读、不接收实时流
- 先完成单 live run + 多历史浏览

---

## 6. 实施阶段与里程碑

---

## Phase 0 — 低风险修复（先止血）

### 目标
不推翻现状，先补最容易出事故的问题。

### 任务

#### F0-1. `/run` 成功后显式切换 active session
**涉及文件**
- `apps/web/src/features/chat/Chat.tsx`
- `apps/web/src/features/session/useSession.ts`
- `apps/web/src/App.tsx`

**改动目标**
- `runSpec()` 收到 `/api/run` 返回后，立刻把新 `projectId/sessionId` 交给 session 层
- 不再依赖左栏轮询来“间接生效”

**验收标准**
- 用户在 Chat 发起新任务后，左栏与中间内容立即切到新 session
- 不需要等待 3 秒轮询

---

#### F0-2. 修复文件预览竞态
**涉及文件**
- `apps/web/src/features/files/useFilePreview.ts`

**改动目标**
- 给文件请求加 `AbortController` 或 `requestId` 防抖保护
- 防止旧响应覆盖新文件内容

**验收标准**
- 用户快速点击不同文件时，最终展示内容与最后一次点击一致

---

#### F0-3. 理顺 `loading` 与 `runStatus`
**涉及文件**
- `apps/web/src/store/graph.ts`
- `apps/web/src/features/chat/Chat.tsx`
- `apps/web/src/components/StatusBadge.tsx`

**改动目标**
- `loading` 仅表示 chat/clarify 请求态
- `runStatus` 表示任务执行生命周期
- `/run` 和 `/resume` 成功后显式设置 `runStatus = running/resuming`

**验收标准**
- 顶栏状态、右侧运行提示、任务真实执行状态一致

---

### Phase 0 完成标准
- 新任务发起后 UI 立即切 session
- 文件预览不再错位
- 运行态 UI 不再前后不一致

---

## Phase 1 — 引入 session-aware execution store

### 目标
建立真正可扩展的 execution 状态模型。

### 任务

#### F1-1. 新建 execution domain
**新增文件**
- `apps/web/src/domains/execution/types.ts`
- `apps/web/src/domains/execution/store.ts`
- `apps/web/src/domains/execution/selectors.ts`
- `apps/web/src/domains/execution/reducer.ts`

**改动目标**
- 不再只有一份全局 graph 状态
- 引入 `sessions: Record<sessionId, SessionExecutionState>`
- 引入 `liveSessionId`

**验收标准**
- 前端可按 session 获取各自的 graph / logs / summary / runStatus

---

#### F1-2. 分离 snapshot 与 realtime event
**涉及文件**
- `apps/web/src/domains/execution/reducer.ts`
- `apps/web/src/features/session/useSession.ts`
- `apps/web/src/hooks/useSSE.ts`

**改动目标**
- 增加：
  - `replaceSessionSnapshot(...)`
  - `applyRealtimeEvent(...)`
- 禁止继续用 `applySSEEvent()` 做历史 hydration

**验收标准**
- session 切换加载历史图时，走 snapshot 入口
- SSE 事件只走 realtime 入口

---

#### F1-3. 为 session 切换增加过期保护
**涉及文件**
- `apps/web/src/features/session/useSession.ts` 或后续 controller

**改动目标**
- 快速切换 session 时，旧请求不能覆盖新 session 视图

**验收标准**
- 快速切多个 session，最终画板永远展示最后一次选中的 session

---

### Phase 1 完成标准
- `graph store` 具备 session 边界
- 历史图与实时图语义分离
- session 快速切换无错乱

---

## Phase 2 — 拆分 orchestration：Chat 不再做总控

### 目标
把运行控制逻辑从 UI 组件中抽出来。

### 任务

#### F2-1. 新建 shared API clients
**新增文件**
- `apps/web/src/shared/api/runClient.ts`
- `apps/web/src/shared/api/chatClient.ts`
- `apps/web/src/shared/api/projectClient.ts`
- `apps/web/src/shared/api/fileClient.ts`
- `apps/web/src/shared/api/sessionClient.ts`

**改动目标**
- 组件中不直接写 `fetchJSON("/api/...")`
- 统一 API 层和错误格式

**验收标准**
- `Chat.tsx`、`ProjectPanel.tsx`、`useFilePreview.ts` 中的裸 API 请求明显减少

---

#### F2-2. 新建 run controller
**新增文件**
- `apps/web/src/domains/execution/runController.ts`

**职责**
- `startRun(spec, repoPath)`
- `resumeRun()`
- `retryNode(nodeId)`

**关键要求**
- `/run` 成功后显式更新：
  - `activeSession`
  - `liveSessionId`
  - 对应 session 的 `runStatus`

**验收标准**
- run/resume/retry 的应用级副作用不再散落在 Chat 组件中

---

#### F2-3. 拆 `Chat.tsx`
**建议拆分**
- `features/chat/ChatPanel.tsx`
- `features/chat/ChatView.tsx`
- `features/chat/MessageList.tsx`
- `features/chat/Composer.tsx`
- `domains/chat/controller.ts`

**改动目标**
- 视图只负责：展示与输入
- controller 负责：意图流、clarify 流、错误处理、调用 run controller

**验收标准**
- `Chat.tsx` 不再直接编排 4+ 个 API
- 组件体积和职责明显下降

---

### Phase 2 完成标准
- Chat 不再是“应用总控器”
- run/resume/retry 生命周期有明确控制层
- API 边界清晰

---

## Phase 3 — Sidebar / Files / Workspace 边界收敛

### 目标
把“用户正在看哪里”与“系统正在运行什么”彻底分开。

### 任务

#### F3-1. 新建 workspace domain
**新增文件**
- `apps/web/src/domains/workspace/types.ts`
- `apps/web/src/domains/workspace/store.ts`
- `apps/web/src/domains/workspace/selectors.ts`
- `apps/web/src/domains/workspace/controller.ts`

**负责**
- active session
- expanded project
- selected file identity
- resumeInfo

---

#### F3-2. Sidebar 数据层解耦
**当前文件**
- `apps/web/src/features/session/ProjectPanel.tsx`

**目标拆分**
- `domains/projects/queries.ts`
- `domains/projects/controller.ts`
- `features/session/ProjectSidebar.tsx`

**改动目标**
- Sidebar 只做展示
- 轮询逻辑从 UI 组件移出
- 让 project list / files list 成为可复用数据源

**验收标准**
- `ProjectSidebar.tsx` 成为相对纯展示组件

---

#### F3-3. 文件预览状态 identity 化
**当前问题**
当前 `selectedFile` 存了完整对象，session 切换时容易脱节。

**目标**
只保存：
- `projectId`
- `sessionId`
- `path`

**验收标准**
- session 切换时，file preview 行为有明确规则：
  - 自动关闭
  - 或仅当 session 匹配时继续展示

---

### Phase 3 完成标准
- workspace 与 execution 边界明确
- sidebar / files 数据流不再和 UI 强耦合
- session 切换不会留下脏文件视图

---

## Phase 4 — UI / A11y / Product polish

### 目标
在架构稳定后统一做产品化打磨。

### 任务

#### F4-1. 统一状态反馈组件
**新增文件**
- `apps/web/src/shared/ui/EmptyState.tsx`
- `apps/web/src/shared/ui/LoadingState.tsx`
- `apps/web/src/shared/ui/InlineError.tsx`
- `apps/web/src/shared/ui/StatusPill.tsx`

**改动目标**
- 收敛 scattered 的 `Loading...` / `thinking...` / `Running...`
- 统一空态、错态、运行态展示

---

#### F4-2. 基础语义与可访问性补齐
**重点**
- `App` 三栏语义化
- Chat/Log tab 的 ARIA 语义
- NodeDetail dialog 化
- 输入框 label / aria-label
- 更明确的 focus-visible

---

#### F4-3. 文案统一
**重点**
- 统一产品语言（建议全中文或全英文）
- 页面 title / lang 修正
- 错误信息改为用户导向

---

### Phase 4 完成标准
- UI 进入对外产品可持续 polish 阶段
- 基础可访问性达标
- 文案和状态反馈一致

---

## 7. 推荐实施顺序（按收益/风险）

### 第 1 批（必须先做）
1. F0-1 `/run` -> activeSession 显式交接
2. F0-2 文件预览竞态修复
3. F0-3 运行态统一

### 第 2 批（核心架构）
4. F1-1 session-aware execution store
5. F1-2 snapshot / realtime 分离
6. F1-3 session 切换过期保护

### 第 3 批（解耦）
7. F2-1 shared API clients
8. F2-2 run controller
9. F2-3 拆 Chat

### 第 4 批（边界收敛）
10. F3-1 workspace domain
11. F3-2 Sidebar 数据层解耦
12. F3-3 文件 identity 化

### 第 5 批（产品化）
13. F4-1 统一状态组件
14. F4-2 A11y 基础补齐
15. F4-3 文案统一

---

## 8. 可并行分工建议（适合不同 AI / 工程师）

> 下列任务尽量按“写入范围互不重叠”来分工，降低冲突。

## Worker A — Execution 状态架构
**负责范围**
- `domains/execution/*`
- `hooks/useSSE.ts`
- execution selectors / reducer / snapshot / event 应用

**目标**
- 建立 session-aware execution store
- 分离 snapshot / realtime
- 引入 `liveSessionId`

**不要修改**
- Chat UI
- Sidebar UI
- 文案/样式

---

## Worker B — Chat orchestration 解耦
**负责范围**
- `features/chat/*`
- `domains/chat/*`
- `domains/execution/runController.ts`
- `shared/api/runClient.ts`
- `shared/api/chatClient.ts`

**目标**
- 抽 `useChatController`
- 抽 `useRunController`
- 让 `/run` 成功后显式切 active session

**不要修改**
- Canvas
- Sidebar 轮询逻辑
- File preview UI

---

## Worker C — Workspace / Sidebar / Files
**负责范围**
- `features/session/*`
- `domains/workspace/*`
- `domains/projects/*`
- `domains/files/*`
- `shared/api/projectClient.ts`
- `shared/api/fileClient.ts`

**目标**
- Sidebar 数据层解耦
- active session / expanded project / selected file 归属明确
- 修复文件预览竞态

**不要修改**
- Chat 业务编排
- SSE / execution reducer

---

## Worker D — UI polish（后置）
**负责范围**
- `shared/ui/*`
- `App` 语义化
- ResumeBar / StatusBadge / EmptyState / LoadingState
- 无障碍与文案

**目标**
- 收敛空态/错态/运行态
- 统一语言和基础 a11y

**前置依赖**
- 需等待 Worker A/B/C 主要结构完成后再做

---

## 9. PR 切分建议

推荐按以下 PR 切：

### PR-1：Immediate correctness fixes
- `/run` 成功后切 active session
- file preview race 修复
- runStatus 基础修正

### PR-2：Execution store foundation
- 新建 `domains/execution/*`
- 引入 session-aware execution state
- snapshot / realtime 分离

### PR-3：Chat controller extraction
- shared API clients
- `runController`
- `useChatController`
- `Chat` 组件瘦身

### PR-4：Workspace and sidebar refactor
- `domains/workspace/*`
- Sidebar 数据层抽离
- file identity 化

### PR-5：UI polish and accessibility
- shared UI states
- 语义化结构
- 文案与可访问性

---

## 10. 每阶段验收 checklist

## Phase 0 Checklist
- [ ] 从 Chat 发起新 run 后，active session 立即切换
- [ ] 左侧 session 高亮立即正确
- [ ] 中间 graph/file 与新 session 对齐
- [ ] 快速切换文件不会错位
- [ ] 顶栏状态与任务状态一致

## Phase 1 Checklist
- [ ] execution store 中存在 `sessions[sessionId]`
- [ ] snapshot 与 realtime 入口分离
- [ ] 快速切 session 不会被旧请求覆盖
- [ ] 可以同时保存多个 session 的执行投影

## Phase 2 Checklist
- [ ] Chat 组件不再直接串多个 API
- [ ] run/resume/retry 由 controller 管理
- [ ] 新 run 后 session 交接显式发生
- [ ] Chat 行为能单独测试 controller

## Phase 3 Checklist
- [ ] active session / selected file / expanded project 归属明确
- [ ] Sidebar 展示与轮询逻辑分离
- [ ] session 切换时文件预览行为可预测

## Phase 4 Checklist
- [ ] 空态/错态/运行态统一
- [ ] Chat/Log tab 具备语义
- [ ] NodeDetail 可作为 dialog 使用
- [ ] 页面文案统一，title/lang 正确

---

## 11. 风险与注意事项

### R1. 后端目前可能仍偏单 live run
从服务端代码看，当前像是“单任务执行”模型。前端本轮建议先完成：
- 多 session 浏览
- 单 live run 显示

不要假设后端已经支持多个 session 同时实时推送。

### R2. 不要一次性删除旧 store
建议：
- 新建 `domains/execution/store.ts`
- 旧 `store/graph.ts` 短期可以做 bridge 或逐步下线

### R3. 不要先做视觉 polish 再做状态重构
否则 UI 改完后还要再返工。

### R4. 每次只推动一条主链路
优先主链路：
- Chat 发起 run
- active session 切换
- graph/live 状态对齐

这条不稳，其他体验优化收益有限。

---

## 12. 第一批建议直接落地的最小任务

如果现在就开始做，建议第一批只做下面 5 个：

1. `runSpec()` 成功后显式 `setActiveSession(...)`
2. `useFilePreview()` 增加竞态保护
3. `runStatus` 统一：区分 chat loading 与 execution runStatus
4. 新建 `domains/execution/types.ts + store.ts`，先把 `sessions[sessionId]` 结构立起来
5. `useSession` 改成 `replaceSessionSnapshot(...)`，不再回放伪事件

这 5 项做完，前端就会从“单页原型”升级到“可继续长的产品前端底座”。

---

## 13. 建议的后续配套文档

建议后续再补两份：

1. `FRONTEND_EXECUTION_MODEL.md`
   - 专门描述 session / live run / snapshot / SSE 的数据模型

2. `FRONTEND_API_CONTRACTS.md`
   - 专门描述前端对 `/run` `/resume` `/chat` `/projects` `/stream` 的依赖与期望

---

## 14. 文档维护规则

后续推进时，建议按以下方式维护本文件：

- 已完成项：在 checklist 中打勾
- 发生方案调整：直接在对应阶段追加“Decision Log”
- 若某阶段拆成多个 PR：在该阶段下补 PR 链接或 commit hash
- 若由不同 AI / 工程师接手：在对应任务下登记 owner

示例：

```md
### F1-2. 分离 snapshot 与 realtime event
- Owner: AI-Worker-B
- Status: In Progress
- PR: #123
- Note: 先保留旧 applySSEEvent 作为兼容层，下个 PR 删除
```

---

## 15. 最终结论

本次前端重构**不建议推倒重来**，而建议：

- 先补正确性
- 再立 session-aware execution 模型
- 再拆 orchestration
- 最后做 UI 与可访问性 polish

对当前 Shipyard 来说，最重要的不是“把 UI 做得更像 IDE”，而是：

> **让前端真正具备多 session 产品心智，并且让 run / resume / retry 的状态流可控。**

这是一切后续产品化工作的基础。

---

## 12. 交接进度记录（2026-04-28）

> 这部分用于交接给下一个 AI / 工程师。只记录**实际已完成状态**、**已知问题**、**下一步边界**。

### 12.1 当前阶段结论

当前实际进度：

- **Phase 0：已完成**
- **Phase 1：主干已完成，且已做一轮稳定性收口**
- **下一步建议：先做 resume 链路彻底 session 化，再进入 Phase 2**

也就是说，当前前端并不是停留在“旧全局 graph store”，而是已经进入：

- session-aware execution store 已接入
- active session / live session 已区分
- snapshot hydration 与 realtime SSE 已分离
- SSE 协议已经补上显式 `projectId/sessionId`

### 12.2 已完成内容（真实代码状态）

#### A. UI 迁移前置阶段已完成
见 `SHADCN_MIGRATION_PLAN.md` 的交接记录，本节不重复展开。

#### B. Phase 0 已完成
已完成的关键点：

1. **新 run 成功后立即切 active session**
   - `apps/web/src/features/chat/Chat.tsx`
   - `apps/web/src/App.tsx`
   - `apps/web/src/features/session/useSession.ts`

2. **session 切换 stale request 防护**
   - `useSession.ts` 中已有 `sessionRequestIdRef`

3. **运行态语义初步理顺**
   - `runStatus` 不再和 chat loading 混用

4. **文件预览竞态低风险修复已完成**
   - `apps/web/src/features/files/useFilePreview.ts`

#### C. Phase 1 主干已完成
已完成的关键点：

1. **新增 execution domain**
   - `apps/web/src/domains/execution/types.ts`
   - `apps/web/src/domains/execution/selectors.ts`
   - `apps/web/src/domains/execution/store.ts`

2. **`useSession` 已改为写入 session-aware execution store**
   - 历史 graph 加载走 `replaceSessionSnapshot(...)`
   - 不再用伪 SSE 回放历史快照

3. **`useSSE` 已改为写入 execution store**
   - 现在 realtime 事件走 `applyRealtimeEvent(...)`

4. **主 UI 已开始从 active session 读取 execution**
   - `apps/web/src/App.tsx`
   - `apps/web/src/features/chat/Chat.tsx`
   - `apps/web/src/features/canvas/Canvas.tsx`

5. **旧 `apps/web/src/store/graph.ts` 仍保留，但已变为兼容 facade**
   - 不再是事实来源
   - 仅用于过渡，后续应删除

#### D. Phase 1 稳定性收口已完成
本轮曾出现一个真实回归：

- React 19 + Zustand selector 返回不稳定 `{}` / `[]`
- 导致：
  - `The result of getSnapshot should be cached`
  - `Maximum update depth exceeded`

已修复：

- `apps/web/src/features/canvas/Canvas.tsx`
- `apps/web/src/features/chat/Chat.tsx`
- `apps/web/src/store/graph.ts`

修复策略：

- 避免在 selector 中返回新的 `{}` / `[]`
- 统一改为模块级稳定常量 `EMPTY_*`
- `store/graph.ts` 改为更稳定的兼容实现

#### E. SSE 协议 session identity 已完成
这是 Phase 1 之后额外完成的一步关键收口。

已完成：

1. **共享 SSE 协议增加身份字段**
   - `packages/shared/src/types.ts`
   - `SSEEvent` 现在包含：
     - `projectId?: string`
     - `sessionId?: string`

2. **后端 SSE 发送点已补齐 identity**
   - `apps/server/src/routes/run.ts`
   - `apps/server/src/sse.ts`
   - `apps/server/src/sse-projection.ts`

3. **前端 SSE 消费已按显式 `event.sessionId` 路由**
   - `apps/web/src/hooks/useSSE.ts`

4. **`StatusResponse` / `ResumeResponse` 已增加 `projectId/sessionId`**
   - 为后续 resume session 化铺路

### 12.3 当前真实架构状态

当前前端 execution 模型已经接近文档第 4 节目标，但仍是“渐进迁移态”：

```ts
ExecutionState {
  sessions: Record<string, SessionExecutionState>
  activeSessionId: string | null
  liveSessionId: string | null
  streamStatus: "disconnected" | "connecting" | "connected" | "error"
}
```

当前语义：

- `activeSessionId`：用户当前正在看的 session
- `liveSessionId`：当前正在接收实时运行事件的 session
- SSE 已优先依据服务端显式 `sessionId` 路由
- 历史快照与实时事件已经分离

### 12.4 已验证项

以下验证已经实际跑过并通过：

- `./node_modules/.bin/tsc -p tsconfig.json --noEmit` ✅
- `pnpm --dir apps/web build` ✅
- `pnpm --filter @shipyard/server build` ✅

说明：

- `pnpm dev` 在当前 AI 工具沙箱中会因为 `tsx watch` 的 IPC pipe 权限失败，
  这不是仓库业务逻辑本身的问题，因此不作为唯一验证标准。

### 12.5 当前仍未完成 / 已知缺口

#### 1. resume 仍未彻底 session 化
虽然：

- `status/resume` 已返回 `projectId/sessionId`
- 前端 `useSession.handleResume()` 也已优先使用这些字段

但后端 resume 的底层仍偏旧模型：

- 仍基于全局 checkpoint 恢复
- 还不是“明确指定某个 session graph 进行恢复”的完整实现

这应作为**下一步最高优先级**。

#### 2. `apps/web/src/store/graph.ts` 仍未删除
当前它只是 compatibility facade，不应继续扩展。

后续目标：

- 删除旧 facade
- UI 全部直接读 `domains/execution/*`

#### 3. Chat orchestration 仍较重
虽然 execution/store 已明显改善，但：

- `Chat.tsx` 仍承担较多 orchestration 逻辑
- 这属于原计划中的 **Phase 2**

#### 4. chat transcript 仍不是 session-aware store
当前 chat message 历史仍主要在组件内 state 中。

### 12.6 下一位 AI 的明确边界（建议直接执行）

**下一步只做这一件事：**

> **把 resume 链路彻底改成按 session 恢复。**

建议范围：

1. 后端：
   - `apps/server/src/routes/resume.ts`
   - 明确使用 session graph 路径恢复，而不是模糊的全局 checkpoint 语义
   - 如有必要，补充 project/session 定位逻辑

2. 前端：
   - `apps/web/src/features/session/useSession.ts`
   - `apps/web/src/features/session/ResumeBar.tsx`
   - 保证 resume 时 active/live session 一致

3. 验证：
   - root typecheck
   - web build
   - server build

### 12.7 下一位 AI 不要重复做的事

以下事项已经做过，**不要重复重构**：

- 不要再次从零设计 session-aware execution store
- 不要重复做 shadcn/Radix 第一批迁移
- 不要再次把 Canvas / Chat 的 selector 稳定性问题“重新修一遍”
- 不要把旧 `store/graph.ts` 当成新的事实来源继续扩展

### 12.8 若继续推进的推荐顺序

1. **先：resume 完整 session 化**
2. **再：删除 `store/graph.ts` 兼容层**
3. **再：进入 Phase 2（拆 Chat orchestration）**

### 12.9 本次交接确认（当前会话补记）

本次会话**未继续推进新的代码实现**，仅完成对当前状态的复核与交接确认。

确认结论：

- 上述 `12.1 ~ 12.8` 仍可视为当前仓库的最新有效进度描述
- 当前主线任务没有变化，仍应优先处理 **resume 按 session 恢复**
- UI 组件迁移计划不再是当前主线，不建议下一位 AI 再回头重做第一批替换
- 本次交接时未新增需要特别说明的前端代码变更

因此，下一位 AI 可直接从：

- `FRONTEND_REFACTOR_PLAN.md` 的 **12.6 下一位 AI 的明确边界**
- 以及相关代码中的 `apps/server/src/routes/resume.ts`、`apps/web/src/features/session/useSession.ts`

开始继续执行。

