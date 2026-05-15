# server-go

Shipyard 的 Go 后端重构实验分支，目标是逐步替换现有 TypeScript 控制面，而不是只做一个占位 scaffold。

## 当前目标

这个应用当前聚焦于 Go 控制面能力：

- session / graph / node 生命周期管理
- SQLite 持久化（projects / sessions / events / graph snapshots）
- 基于 actor 的 session runtime
- planner / executor / verifier 的可插拔编排
- SSE 事件回放与实时流式订阅
- 本地 ToolRunner 抽象，为后续 sidecar / RPC 执行器预留边界

## 当前已实现

### 控制面 / 运行时

- `Runtime Manager` 管理多 session runtime
- `SessionRuntime` 支持：
  - graph bootstrap
  - checkpoint pause / approve / resume
  - implement 节点执行
  - verify 阶段
  - verify 失败后按重试次数回退重跑
  - graph completed / failed 收敛
- graph snapshot 会在关键阶段落库

### 持久化

基于 SQLite（`modernc.org/sqlite`）：

- `projects`
- `sessions`
- `events`
- `graph_snapshots`

### 规划 / 执行 / 验证

- `StaticPlanner`：基础 fallback 规划器
- `LLMPlanner`：基于 OpenAI-compatible 接口生成 graph，失败时自动回退
- `LLMImplementExecutor`：当前实现为“让 LLM 生成目标文件完整内容，再通过 ToolRunner 落盘”
- `BasicVerifier`：当前支持
  - 输出文件存在性校验
  - TypeScript `tsc --noEmit` 校验（若存在 TypeScript 编译器）
  - JavaScript `node --check`
  - Go `go test ./...`
  - Python `py_compile`
  - 可选 ESLint
  - 可选 reviewer LLM 审阅

### API / Stream

已暴露接口：

- `GET /health`
- `POST /api/runs`
- `POST /api/runs/{sessionId}/resume`
- `POST /api/runs/{sessionId}/nodes/{nodeId}/retry`
- `POST /api/runs/{sessionId}/checkpoints/{nodeId}/approve`
- `GET /api/projects`
- `GET /api/sessions/{sessionId}`
- `GET /api/stream?sessionId=...&afterRevision=...`

其中 `/api/stream` 支持：

- 先从 SQLite replay 历史 events
- 再订阅内存 broker 的实时事件

## 当前仍未完成

这还不是最终替换版，以下部分仍需继续补齐：

- implement executor 从“单次整文件生成”升级到真正的多步 tool loop
- 更强的 repo-aware verifier（按项目类型自动选择 test / lint / build 命令）
- preview / sandbox sidecar 集成
- 与现有 TS 后端更完整的功能对齐
- 更细粒度的恢复、并发调度、可观测性指标

## 运行

```bash
go run ./cmd/api
```

默认监听：

- `http://localhost:8080`

## 环境变量

- `OPENAI_BASE_URL`
- `OPENAI_API_KEY`
- `MODEL_PLANNER`
- `MODEL_IMPLEMENTER`
- `MODEL_REVIEWER`
- `SHIPYARD_WORKSPACE_DIR`

## 备注

当前环境下更可靠的验证方式仍然是：

```bash
go build ./...
```

如果本地沙箱不允许绑定端口，HTTP 启动测试可能会受限，但编译与单次 handler/route 级验证仍可继续推进。
