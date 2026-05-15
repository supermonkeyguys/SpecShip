# Shipyard Go 后端重构方案（目录结构 + 核心接口骨架）

> 目标：不是把当前 TypeScript/Node 后端逐行翻译成 Go，而是把 Shipyard 重构为一个更适合并发编排、事件驱动、可恢复执行的后端控制面。
>
> 推荐路线：**Go 控制面 + Node 工具执行面（sidecar）**。

---

## 1. 目标与边界

### 1.1 本文解决什么问题

当前项目后端已经具备较完整的 AI 编排能力：

- spec -> plan -> graph
- 节点执行 / verify / review
- retry / resume / checkpoint
- SSE 推送
- snapshot + event log
- preview 管理

但如果目标从“本地单用户工具”升级到“可扩展的后端平台”，当前实现会逐渐遇到这些限制：

- 全局单例状态较多，单任务互斥明显
- sync I/O 和文件型持久化不适合扩展
- route/controller 逻辑变重
- tool runner 安全边界不够硬
- 事件回放和 revision 控制成本偏高

本文提供的是一个**Go 版目标架构骨架**，重点回答：

1. Go 版项目目录应该怎么组织
2. 核心接口应该怎么定义
3. Session Runtime / Scheduler 应该怎么设计
4. 哪些职责留在 Go，哪些职责继续留在 Node
5. 迁移应该怎么分阶段推进

---

### 1.2 本文不做什么

本文**不**试图：

- 逐文件翻译当前 TS 实现
- 一次性替代所有前端工具链逻辑
- 把 preview / npm / vite / tsc 全部纯 Go 化

原因很简单：Shipyard 本质上仍然依赖 JS/TS 工具生态，因此更合理的形态是：

- **Go**：负责 API、状态管理、编排、事件流、并发控制
- **Node sidecar**：负责文件写入、命令执行、JS 工具链验证、preview 启停

---

## 2. 重构目标

### 2.1 架构目标

新的 Go 后端应具备：

- 支持多 session 并发，而不是全局单活
- 每个 session 有独立 runtime
- 事件存储是一等公民，snapshot 只是优化
- API 层足够薄，不承担 orchestration 逻辑
- tool execution 边界前置校验，避免先写后判错
- 运行时支持 cancel / timeout / retry / checkpoint
- 未来可平滑切换 SQLite -> Postgres / 本地 runtime -> Temporal

---

### 2.2 设计原则

1. **事件优先（event-first）**
   - 所有重要状态变化都先成为事件
   - snapshot 只是读优化和恢复加速，不是唯一真相

2. **session actor 模型**
   - 每个 session 一个 runtime actor
   - session 内状态更新串行化
   - session 之间并发

3. **控制面和执行面分离**
   - Go 管 session / graph / scheduler
   - Node 管 JS 工具链和沙箱内操作

4. **接口先稳定，再迁移实现**
   - 先定义 planner / executor / verifier / event store 契约
   - 再逐步替换旧 TS 编排代码

5. **先做最小可用骨架，再补细节 parity**
   - 优先跑通 run/resume/retry/stream 主链路
   - 复杂 preview rewrite / parity report / temporal 兼容后置

---

## 3. 推荐的总体形态

## 3.1 推荐方案：Go 控制面 + Node 执行面

### Go 控制面职责

- HTTP API / SSE
- session lifecycle
- graph state machine
- scheduler / worker dispatch
- event store / snapshot store
- retry / checkpoint / resume
- project/session 查询
- 并发控制与资源治理

### Node sidecar 职责

- 写文件 / 读文件 / 搜索文件
- 执行允许的命令（tsc / npm / pnpm / vite / next 等）
- verify 期的 JS/TS 生态适配
- preview 拉起、停止、日志转发

### 不推荐的方案

#### A. 纯 Go 一把梭
缺点：
- 需要自己接更多 JS 工具链适配层
- 复杂度显著上升
- 迁移成本大，短期价值不高

#### B. 继续在 TS 上堆运行时
缺点：
- 可以做，但未来多 session / durability / operator model 会越来越难维护

---

## 4. Go 版推荐目录结构

```txt
shipyard-go/
  cmd/
    api/
      main.go
    worker/
      main.go

  internal/
    config/
      config.go

    domain/
      graph.go
      node.go
      session.go
      event.go
      errors.go
      state_machine.go

    app/
      run_service.go
      resume_service.go
      retry_service.go
      checkpoint_service.go
      project_service.go
      artifact_service.go
      stream_service.go

    runtime/
      manager.go
      session_runtime.go
      scheduler.go
      node_executor.go
      checkpoint_manager.go
      event_publisher.go
      runtime_types.go

    store/
      sqlite/
        db.go
        session_repo.go
        graph_repo.go
        event_repo.go
        artifact_repo.go
        snapshot_repo.go

    infra/
      llm/
        client.go
        responses_client.go
        chat_completions_client.go
        retry.go
      toolrunner/
        client.go
        types.go
      preview/
        client.go
      logging/
        logger.go
      metrics/
        metrics.go

    transport/
      http/
        router.go
        middleware.go
        handlers/
          run_handler.go
          resume_handler.go
          node_handler.go
          project_handler.go
          artifact_handler.go
          preview_handler.go
          stream_handler.go
      sse/
        broker.go

  migrations/
    001_init.sql
    002_events.sql
    003_snapshots.sql

  api/
    openapi/
      shipyard.yaml
```

---

## 5. 分层职责定义

## 5.1 `domain/`：纯业务模型与规则

只放：

- Graph / Node / Session / Event 模型
- 状态机
- retry / block / unblock / dependency readiness 规则
- 纯函数或小型方法

绝不放：

- HTTP
- DB
- LLM
- shell command
- fs 读写

### 示例：`graph.go`

```go
package domain

import "time"

type GraphStatus string

const (
    GraphBuilding GraphStatus = "building"
    GraphRunning  GraphStatus = "running"
    GraphPaused   GraphStatus = "paused"
    GraphDone     GraphStatus = "done"
    GraphFailed   GraphStatus = "failed"
)

type Graph struct {
    ID           string
    Title        string
    OriginalSpec string
    Status       GraphStatus
    Nodes        map[string]*Node
    CreatedAt    time.Time
    UpdatedAt    time.Time
    CompletedAt  *time.Time
}
```

### 示例：`node.go`

```go
package domain

import "time"

type NodeStatus string

type NodeType string

type ErrorKind string

const (
    NodePending   NodeStatus = "pending"
    NodeReady     NodeStatus = "ready"
    NodeRunning   NodeStatus = "running"
    NodeVerifying NodeStatus = "verifying"
    NodeDone      NodeStatus = "done"
    NodeFailed    NodeStatus = "failed"
    NodeBlocked   NodeStatus = "blocked"
    NodeSkipped   NodeStatus = "skipped"
)

const (
    NodeImplement  NodeType = "implement"
    NodeCheckpoint NodeType = "checkpoint"
)

const (
    ErrorFatal  ErrorKind = "fatal"
    ErrorVerify ErrorKind = "verify"
    ErrorReview ErrorKind = "review"
)

type Node struct {
    ID                 string
    Type               NodeType
    Title              string
    Role               string
    Task               string
    AcceptanceCriteria string
    DependsOn          []string
    Outputs            []string

    Status        NodeStatus
    RetryCount    int
    MaxRetries    int
    LastError     string
    LastErrorKind ErrorKind

    Evidence   *Evidence
    CreatedAt  time.Time
    UpdatedAt  time.Time
}
```

### 示例：`event.go`

```go
package domain

import (
    "encoding/json"
    "time"
)

type Event struct {
    ID        string
    SessionID string
    Revision  int64
    Type      string
    Payload   json.RawMessage
    CreatedAt time.Time
}
```

---

## 5.2 `app/`：应用服务层

这一层负责“用例编排”，例如：

- StartRun
- ResumeRun
- RetryNode
- ApproveCheckpoint
- ListProjects
- StreamEvents

它调用：

- repositories
- runtime manager
- event publisher
- llm / toolrunner abstraction

但自己不直接做复杂调度循环。

### 示例：`run_service.go`

```go
package app

import (
    "context"
)

type RunService struct {
    Sessions SessionRepository
    Runtime  RuntimeManager
    Projects ProjectRepository
}

type StartRunInput struct {
    Spec       string
    RepoPath   string
    StrategyID string
}

type StartRunOutput struct {
    ProjectID string
    SessionID string
    GraphID   string
}

func (s *RunService) StartRun(ctx context.Context, in StartRunInput) (*StartRunOutput, error) {
    // 1. 创建 project/session
    // 2. 启动 runtime
    // 3. 返回 ids
    return &StartRunOutput{}, nil
}
```

### 示例：`retry_service.go`

```go
package app

import "context"

type RetryService struct {
    Runtime RuntimeManager
}

func (s *RetryService) RetryNode(ctx context.Context, sessionID, nodeID string) error {
    return s.Runtime.Send(ctx, sessionID, RetryNodeCommand{NodeID: nodeID})
}
```

---

## 5.3 `runtime/`：真正的调度与执行运行时

这是 Go 重构最值得投入的部分。

### 关键思想：每个 session 一个 actor

- 每个 session 有一个 `SessionRuntime`
- 外部通过 `Command` 往 runtime 发消息
- runtime 串行更新 graph 状态
- 节点执行结果异步返回，再由 runtime 合并

### 推荐结构

#### `manager.go`

```go
package runtime

import "context"

type RuntimeManager interface {
    Start(ctx context.Context, sessionID string, input StartInput) error
    Send(ctx context.Context, sessionID string, cmd Command) error
    Stop(ctx context.Context, sessionID string) error
}
```

#### `runtime_types.go`

```go
package runtime

import "context"

type Command interface {
    commandName() string
}

type RetryNodeCommand struct {
    NodeID string
}
func (RetryNodeCommand) commandName() string { return "retry_node" }

type ResumeCommand struct{}
func (ResumeCommand) commandName() string { return "resume" }

type ApproveCheckpointCommand struct {
    NodeID string
}
func (ApproveCheckpointCommand) commandName() string { return "approve_checkpoint" }

type StartInput struct {
    ProjectID  string
    SessionID  string
    Spec       string
    RepoPath   string
    StrategyID string
}

type Scheduler interface {
    ExecuteNode(ctx context.Context, sessionID string, nodeID string) (<-chan NodeResult, error)
}
```

#### `session_runtime.go`

```go
package runtime

import (
    "context"
    "shipyard-go/internal/domain"
)

type SessionRuntime struct {
    sessionID string
    graph     *domain.Graph

    commands chan Command
    results  chan NodeResult

    scheduler Scheduler
    events    EventPublisher
    store     RuntimeStore
}

func (r *SessionRuntime) Run(ctx context.Context) error {
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case cmd := <-r.commands:
            if err := r.handleCommand(ctx, cmd); err != nil {
                return err
            }
        case result := <-r.results:
            if err := r.handleNodeResult(ctx, result); err != nil {
                return err
            }
        }
    }
}
```

### `NodeResult` 建议

```go
package runtime

import "shipyard-go/internal/domain"

type NodeResult struct {
    NodeID      string
    Evidence    *domain.Evidence
    OutputFiles []string
    FatalError  string
}
```

---

## 5.4 `store/`：持久化层

建议从第一版起就别再依赖 JSON 文件作为主存储。

### 推荐起步：SQLite

优点：

- 本地单机也适用
- 支持事务
- revision append 更容易保证一致性
- 比 json snapshot + jsonl append 更适合恢复和查询

### 建议的 repository 接口

```go
package app

import (
    "context"
    "shipyard-go/internal/domain"
)

type SessionRepository interface {
    Create(ctx context.Context, s *domain.Session) error
    Get(ctx context.Context, sessionID string) (*domain.Session, error)
    UpdateStatus(ctx context.Context, sessionID string, status domain.SessionStatus) error
}

type GraphRepository interface {
    SaveSnapshot(ctx context.Context, sessionID string, g *domain.Graph) error
    LoadSnapshot(ctx context.Context, sessionID string) (*domain.Graph, error)
}

type EventStore interface {
    Append(ctx context.Context, sessionID string, expectedRevision int64, events []domain.Event) error
    List(ctx context.Context, sessionID string, afterRevision int64) ([]domain.Event, error)
}
```

### 建议的表

- `projects`
- `sessions`
- `graphs` 或 `graph_snapshots`
- `nodes`（可选；也可从 snapshot 取）
- `events`
- `artifacts`
- `preview_sessions`

---

## 5.5 `infra/llm/`：LLM 客户端层

这里可以沿用当前 TS 的好思路：

- 优先 `/responses`
- 失败 fallback `/chat/completions`
- 支持 stream body 解析
- 支持 tool loop
- 有 retry/backoff

### 接口建议

```go
package llm

import "context"

type Client interface {
    Run(ctx context.Context, in RunInput) (*RunOutput, error)
}

type RunInput struct {
    SystemPrompt string
    UserPrompt   string
    Model        string
    Tools        []ToolDef
    WithTools    bool
}

type RunOutput struct {
    FinalText      string
    ToolExecutions []ToolExecution
    TokensUsed     int
}
```

---

## 5.6 `infra/toolrunner/`：Node sidecar 客户端

这是控制面和执行面的桥。

### 设计目标

- Go 不直接 `exec shell string`
- Go 通过结构化 RPC 请求 sidecar
- sidecar 才真正执行 write/read/search/command/preview
- 所有安全校验在执行前完成

### 接口建议

```go
package toolrunner

import "context"

type Client interface {
    WriteFile(ctx context.Context, req WriteFileRequest) (*WriteFileResponse, error)
    ReadFile(ctx context.Context, req ReadFileRequest) (*ReadFileResponse, error)
    SearchFiles(ctx context.Context, req SearchFilesRequest) (*SearchFilesResponse, error)
    RunCommand(ctx context.Context, req RunCommandRequest) (*RunCommandResponse, error)
    StartPreview(ctx context.Context, req StartPreviewRequest) (*StartPreviewResponse, error)
    StopPreview(ctx context.Context, req StopPreviewRequest) (*StopPreviewResponse, error)
}
```

### `RunCommandRequest` 建议用 argv，不要 shell string

```go
package toolrunner

type RunCommandRequest struct {
    SessionID string
    WorkDir   string
    Program   string
    Args      []string
    TimeoutMs int
}
```

这一点非常重要：

- 不要再复刻 TS 里 `execSync(command string)` 的模式
- 一定要用 `program + args[]`
- allowlist 也基于 `program` 和参数模式做检查

---

## 5.7 `transport/http/`：API 层

Go handler 应尽量薄。

### 只做三件事

1. 参数解析
2. 调用 app service
3. 返回 JSON / SSE

### 示例：`run_handler.go`

```go
package handlers

import (
    "encoding/json"
    "net/http"
    "shipyard-go/internal/app"
)

type RunHandler struct {
    Service *app.RunService
}

type StartRunRequest struct {
    Spec       string `json:"spec"`
    RepoPath   string `json:"repoPath,omitempty"`
    StrategyID string `json:"strategyId,omitempty"`
}

func (h *RunHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    var req StartRunRequest
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        http.Error(w, err.Error(), http.StatusBadRequest)
        return
    }

    out, err := h.Service.StartRun(r.Context(), app.StartRunInput{
        Spec:       req.Spec,
        RepoPath:   req.RepoPath,
        StrategyID: req.StrategyID,
    })
    if err != nil {
        http.Error(w, err.Error(), http.StatusInternalServerError)
        return
    }

    _ = json.NewEncoder(w).Encode(out)
}
```

---

## 5.8 `transport/sse/`：事件推送

推荐不要再做“全局 nodeCache 单例”，而是：

- 按 session 建订阅流
- 新连接先 replay 指定 revision 之后的 event
- 再接入 live subscription

### Broker 接口

```go
package sse

import "context"

type Event struct {
    SessionID string
    Revision  int64
    Type      string
    Data      []byte
}

type Broker interface {
    Publish(ctx context.Context, evt Event) error
    Subscribe(ctx context.Context, sessionID string, afterRevision int64) (<-chan Event, error)
}
```

---

## 6. 核心运行时流程

## 6.1 Start Run 流程

1. API 调 `RunService.StartRun`
2. 创建 `project` / `session`
3. `RuntimeManager.Start(sessionID, input)`
4. runtime 初始化 graph：
   - 调 planner
   - 生成 graph.initialized event
   - 保存 snapshot
5. runtime 开始调度 ready nodes
6. 节点执行结果进入 `results channel`
7. runtime 更新 graph / 追加 events / 发布 SSE
8. 直到：
   - 全部 done -> session.completed
   - 或失败 -> session.failed
   - 或 checkpoint pause -> session.paused

---

## 6.2 Retry Node 流程

1. API 调 `RetryService.RetryNode`
2. 发 `RetryNodeCommand{NodeID}` 到对应 session runtime
3. runtime 校验 node 当前状态是否允许 retry
4. 重置 node 到 ready
5. 解除必要的 blocked downstream
6. 记录 event
7. 触发重新调度

---

## 6.3 Resume 流程

1. API 调 `ResumeService.Resume`
2. 发 `ResumeCommand`
3. runtime 把 paused/running/verifying 的中间态恢复成可执行态
4. 继续调度

---

## 6.4 Checkpoint 流程

1. runtime 调度到 checkpoint node
2. graph 状态切到 paused
3. 发布 `checkpoint.paused`
4. 等待外部 `ApproveCheckpointCommand`
5. 收到后恢复 running
6. 发布 `checkpoint.resumed`

---

## 7. 策略系统建议保留，但放到 Go 里重做接口

当前 TS 的 `strategy` 概念是值得保留的。

### 建议接口

```go
package app

type Strategy interface {
    ID() string
    Name() string
    Detect(spec string) float64
    PlanPrompt() string
    AllowedExtensions() []string
    AllowedCommands() []AllowedCommand
    ReviewerPrompt() string
    ImplementerPrompt() string
    TesterPrompt() string
}
```

### 建议内置策略

- `typescript-lib`
- `react-app`
- `node-server`
- `static-web`

但第一版不要急着把所有 prompt 体系搬完整，先把接口稳定住。

---

## 8. 安全边界重做建议

这是 Go 重构时必须一起升级的部分。

## 8.1 写文件：必须前置校验

当前 TS 的问题是：

- `write_file` 先执行
- 再做 `ensureWritesStayWithinExpectedOutputs`

Go 版必须改成：

1. planner/graph 给出 node 允许写的 outputs
2. node executor 构造 allowlist
3. sidecar 收到写文件请求时，先验路径
4. 校验通过后才真正写盘

### 建议请求结构

```go
type WriteFileRequest struct {
    SessionID     string
    RelativePath  string
    Content       string
    AllowedWrites []string
}
```

---

## 8.2 命令执行：结构化 argv + allowlist

绝不要继续用 `shell command string`。

### 推荐 allowlist 结构

```go
type AllowedCommand struct {
    Program string
    PrefixArgs []string
}
```

例如：

- `npm run build`
- `npm test`
- `pnpm exec tsc`
- `node --check`
- `vite --host 127.0.0.1 --port ...`

sidecar 校验逻辑：

- program 必须匹配 allowlist
- args 前缀必须匹配 allowlist
- 禁止 `sh -c` / `bash -lc`
- 禁止 shell metacharacter 逃逸路径

---

## 8.3 每个 session 最好有独立 workspace

从长期看，最好的方案不是所有 session 共用一个大 workDir，而是：

- `workspaceRoot/sessions/{sessionID}/workdir`
- repo-edit 模式下使用 worktree / 临时 clone / bind mount / 容器

这样：

- 不同 session 不互相污染
- artifact 更容易归档
- 恢复和回放更清晰

---

## 9. 最小可用骨架（MVP）范围

第一版 Go 不要追求 feature parity 100%。

## 9.1 建议第一版必须实现

### API
- `POST /api/runs`
- `POST /api/runs/{sessionId}/resume`
- `POST /api/runs/{sessionId}/nodes/{nodeId}/retry`
- `GET /api/projects`
- `GET /api/sessions/{sessionId}`
- `GET /api/stream?sessionId=...`

### Runtime
- session actor
- planner -> graph
- execute -> verify -> review 主链路
- checkpoint pause/resume
- retry node
- snapshot + events

### Infra
- SQLite store
- LLM client
- Node toolrunner client

---

## 9.2 建议延后实现

- preview 的复杂代理和 HTML/JS rewrite
- node edit impact analysis 全量迁移
- Temporal mode 兼容
- parity report / snapshot-vs-replay 对账工具
- 高级 plan mode 兼容性

---

## 10. 迁移路线建议

## Phase 0：冻结协议

先在现有 TS 项目中冻结这些协议：

- session / graph / node 状态字段
- event schema
- SSE payload schema
- toolrunner request/response schema

目标：避免 Go 重构过程中前后端契约持续漂移。

---

## Phase 1：先抽象存储和 toolrunner 协议

在 TS 中先把：

- checkpoint
- op-log
- session meta
- file artifact

抽成接口层。

同时定义 Node sidecar 的协议草案。

---

## Phase 2：Go 先实现只读控制面

只做：

- 读 project/session
- 读 snapshot/event
- SSE replay

目的：先验证存储模型和传输协议。

---

## Phase 3：Go 接管 runtime

实现：

- runtime manager
- session actor
- scheduler
- retry / resume / checkpoint

节点执行仍通过 Node sidecar 或旧 TS 执行器进行。

---

## Phase 4：Go 接管主 API

前端改连 Go API。

旧 TS server 逐步降级成：

- tool sidecar
- preview sidecar

---

## Phase 5：逐步淘汰旧 TS orchestration

最后 TS 只保留：

- JS 生态工具执行
- preview 管理
- 必要的前端编译链桥接

---

## 11. 推荐的第一版核心接口汇总

下面是一组够开工的最小接口集合。

### `domain/session.go`

```go
package domain

import "time"

type SessionStatus string

const (
    SessionRunning     SessionStatus = "running"
    SessionPaused      SessionStatus = "paused"
    SessionDone        SessionStatus = "done"
    SessionFailed      SessionStatus = "failed"
    SessionInterrupted SessionStatus = "interrupted"
)

type Session struct {
    ID        string
    ProjectID string
    Spec      string
    Status    SessionStatus
    CreatedAt time.Time
    UpdatedAt time.Time
}
```

### `runtime/manager.go`

```go
package runtime

import (
    "context"
    "sync"
)

type InMemoryManager struct {
    mu       sync.RWMutex
    sessions map[string]*SessionRuntime
}

func NewInMemoryManager() *InMemoryManager {
    return &InMemoryManager{
        sessions: map[string]*SessionRuntime{},
    }
}

func (m *InMemoryManager) Start(ctx context.Context, sessionID string, input StartInput) error {
    // 创建并启动 session runtime
    return nil
}

func (m *InMemoryManager) Send(ctx context.Context, sessionID string, cmd Command) error {
    // 查找 runtime 并投递 command
    return nil
}

func (m *InMemoryManager) Stop(ctx context.Context, sessionID string) error {
    // 停止 runtime
    return nil
}
```

### `app/interfaces.go`

```go
package app

import (
    "context"
    "shipyard-go/internal/domain"
)

type ProjectRepository interface {
    List(ctx context.Context) ([]*domain.Project, error)
}

type RuntimeManager interface {
    Start(ctx context.Context, sessionID string, input any) error
    Send(ctx context.Context, sessionID string, cmd any) error
    Stop(ctx context.Context, sessionID string) error
}
```

### `infra/toolrunner/types.go`

```go
package toolrunner

type ToolExecution struct {
    Tool     string
    Success  bool
    Output   string
    FilePath string
}

type WriteFileResponse struct {
    Success bool
    Output  string
}

type RunCommandResponse struct {
    Success bool
    Stdout  string
    Stderr  string
    ExitCode int
}
```

---

## 12. 如果只做一个“首批开发清单”，我建议是这 10 项

1. 初始化 `shipyard-go` 仓库目录
2. 定义 `domain` 模型和状态机
3. 接入 SQLite + migrations
4. 实现 `SessionRepository / EventStore / GraphRepository`
5. 实现 `RuntimeManager + SessionRuntime`
6. 实现 `RunService / ResumeService / RetryService`
7. 实现 `HTTP handlers + router`
8. 实现 `SSE broker`
9. 定义 `toolrunner` RPC/HTTP 协议
10. 先接一个最小 Node sidecar（write/read/run command）

只要这 10 项完成，就已经能跑出一版真正的 Go 控制面骨架。

---

## 13. 最终建议

如果 Shipyard 未来目标是：

- 不止本地玩具
- 能支持多 session 并发
- 有更强的 durability / observability / deployment 需求

那么 Go 重构是值得做的。

但最优路线不是：

> “把现在的 TS 后端完整翻译成 Go”

而是：

> **用 Go 重构控制面，用 Node 保留执行面，先把运行时模型和事件存储做对。**

一句话总结：

**Go 的价值，不在于替换 TypeScript 语法，而在于逼迫后端从“单进程本地工具心智”升级成“可扩展编排系统心智”。**

