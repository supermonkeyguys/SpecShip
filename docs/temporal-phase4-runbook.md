# Phase 4 — Temporal 灰度切换操作手册

## 快速启动（本地开发）

```bash
# Terminal 1 — 启动 Temporal dev server（内存模式，重启后历史清空）
temporal server start-dev

# Terminal 2 — 启动 Temporal Worker（执行 Activities）
OPENAI_API_KEY=sk-xxx \
OPENAI_BASE_URL=https://your-relay/v1 \
pnpm temporal:worker

# Terminal 3 — 启动 API server（Temporal 模式）
ORCHESTRATOR_MODE=temporal \
OPENAI_API_KEY=sk-xxx \
pnpm server:dev

# Terminal 4 — 启动前端
pnpm web:dev
```

Temporal Web UI：http://localhost:8233

## 模式切换

| 环境变量 | 行为 |
|---------|------|
| `ORCHESTRATOR_MODE=legacy`（默认） | 直接调用 core run()，不依赖 Temporal |
| `ORCHESTRATOR_MODE=temporal` | 启动 SpecRunWorkflow，需要 Worker 在线 |

## 回滚条件（任一满足立即切回 legacy）

- Temporal 路径成功率连续低于 80%
- Worker 进程不可用超过 30 秒
- Workflow determinism 错误出现（日志关键词：`NonDeterministicWorkflowError`）

回滚操作：
```bash
# 修改环境变量，重启 server 即可（Worker 可继续运行）
ORCHESTRATOR_MODE=legacy pnpm server:dev
```

## 环境变量说明

| 变量 | 默认值 | 说明 |
|------|-------|------|
| `ORCHESTRATOR_MODE` | `legacy` | `legacy` 或 `temporal` |
| `TEMPORAL_ADDRESS` | `localhost:7233` | Temporal server gRPC 地址 |
| `TEMPORAL_NAMESPACE` | `default` | Temporal 命名空间 |
| `TEMPORAL_TASK_QUEUE` | `specship-main` | Worker 监听的 Task Queue |

## 验收标准（Phase 4 DoD）

- [x] `run/resume/retry/status` 在 Temporal 模式行为与 legacy 一致
- [ ] 进程重启后，运行中任务自动恢复（Temporal Web UI 可见）
- [x] `ORCHESTRATOR_MODE=legacy` 单开关回退 legacy 成功
- [x] 双跑测试通过（`pnpm test`）

## 已知限制（待后续阶段处理）

- SSE 推送依赖文件 projection（`fs.watch`），Windows 上可能有延迟
- “进程重启后自动恢复”的真实验证依赖手工环境演练，当前未纳入自动化回归

## 状态对齐说明（2026-05-03）

以下能力已在代码中接入：
- `POST /api/resume` Temporal 路径已接入 `signalResumeRun`（`apps/server/src/routes/resume.ts`）
- `POST /api/node/:id/retry` Temporal 路径已接入 `signalRetryNode`（`apps/server/src/routes/node.ts`）
- `GET /api/status` Temporal 路径已改为 Query `querySpecRunSummary`（`apps/server/src/routes/resume.ts`）
- 双跑与信号链路测试已存在于 `packages/orchestrator-temporal/test/*`
