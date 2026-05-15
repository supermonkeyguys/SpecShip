# Go Backend Rollout / Rollback Runbook

> 更新（main）：当前仓库开发默认后端已切到 `apps/server-go`，`apps/server/src` 继续保留为 TS fallback。本文保留的是风险、验收和回滚视角，不代表 TS 已被删除。

> worktree: `/private/tmp/shipyard-go-spike`
> branch: `feat-go-backend-spike`
> date: 2026-05-15

## 目标

这份 runbook 只回答一个问题：

**如果要让 `apps/web` 接到 `apps/server-go`，如何进行受控切换，以及如何快速回滚到 TS backend。**

当前定位仍是：
- experimental / shadow backend
- 非默认主线后端

在未完成最终浏览器级验收与 live preview 能力前，不应直接把 Go backend 设为唯一默认后端。

---

## 1. 当前切换手段

### Web → Go backend

`apps/web` 当前已支持通过环境变量覆盖 API proxy：

```bash
env SHIPYARD_WEB_API_PROXY_TARGET=http://127.0.0.1:8080 \
  pnpm --dir apps/web dev --host 127.0.0.1 --port 5173
```

这会把页面 origin 下的：
- `/api/status`
- `/api/run`
- `/api/projects`
- `/api/stream`
- 以及其它 `/api/*`

代理到 `server-go`。

### Web → TS backend（回滚）

只需恢复默认 proxy target，或显式指回 TS backend：

```bash
env SHIPYARD_WEB_API_PROXY_TARGET=http://127.0.0.1:5174 \
  pnpm --dir apps/web dev --host 127.0.0.1 --port 5173
```

---

## 2. 推荐 rollout 阶段

### Phase A — Local shadow validation

目标：只在本地/开发环境验证 Go backend

- 启动 `server-go`
- web 通过 `SHIPYARD_WEB_API_PROXY_TARGET` 指向 Go backend
- 验证：
  - `/api/status`
  - `/api/projects`
  - `/api/run`
  - `/api/stream`
  - files / preview
  - crash/restart recovery

成功标准：
- 成功/失败/恢复路径均可跑通
- 页面主流程无明显阻塞级错误

### Phase B — Explicit opt-in developer usage

目标：仅允许明确 opt-in 的开发者使用 Go backend

建议方式：
- 保持 TS backend 为默认
- 仅在需要时显式设置 `SHIPYARD_WEB_API_PROXY_TARGET`
- 记录所有已知 UI/preview 差异

成功标准：
- 多名开发者可重复复现本地联调成功路径
- 无明显“恢复后命令失效”类问题

### Phase C — Pre-default gate

只有在以下条件满足时，才允许考虑默认切换：

- 真实页面交互验收通过
- live preview 方案明确
- crash/restart 场景完成运行级补验
- rollback 步骤已演练

---

## 3. 启动命令

### Start Go backend

```bash
env GOCACHE=/private/tmp/shipyard-go-gocache \
  SHIPYARD_WORKSPACE_DIR=/private/tmp/shipyard-go-recovery-workspace \
  go run ./cmd/api
```

### Start web against Go backend

```bash
env SHIPYARD_WEB_API_PROXY_TARGET=http://127.0.0.1:8080 \
  pnpm --dir apps/web dev --host 127.0.0.1 --port 5173
```

### Health checks

```bash
curl -L http://127.0.0.1:8080/health
curl -L http://127.0.0.1:5173/api/status
curl -L -N http://127.0.0.1:5173/api/stream
```

---

## 4. Rollback steps

如果 Go backend 出现以下任一情况，应立即回滚到 TS backend：

- 页面无法继续 run / resume / retry / approve
- `/api/stream` 断流导致 UI 状态失真
- preview 面板阻断主要流程
- crash/restart 后 session 无法恢复命令处理

### Fast rollback

1. 停止当前 web dev server
2. 重新以 TS backend target 启动：

```bash
env SHIPYARD_WEB_API_PROXY_TARGET=http://127.0.0.1:5174 \
  pnpm --dir apps/web dev --host 127.0.0.1 --port 5173
```

3. 确认：
- `5173/api/status` 返回 TS backend 数据
- `5173/api/stream` 恢复到 TS backend
- 页面可正常开始/恢复任务

---

## 5. 当前已知限制

当前 Go backend 仍不建议作为唯一默认后端，原因包括：

1. live preview 仍未达到 TS 版能力
2. 最终浏览器点击级验收仍未完成
3. rollout 仍以“显式 opt-in”方式更安全

---

## 6. 当前结论

截至 2026-05-15：

- Go backend 已具备较强的本地联调与恢复能力
- 已支持通过 web proxy 显式切换接入
- 已有清晰 rollback 路径
- 但仍未达到“可以无条件替换 TS backend 并并入 main 作为默认实现”的标准
