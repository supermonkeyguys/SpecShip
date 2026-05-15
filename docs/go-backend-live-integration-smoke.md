# Go Backend Live Integration Smoke（运行级联调记录）

> worktree: `/private/tmp/shipyard-go-spike`
> branch: `feat-go-backend-spike`
> date: 2026-05-15

## 目的

这次验证不是单元测试，也不是单纯 `go build`。

目标是做一轮更接近真实前端接入的 **运行级 smoke test**，验证 `apps/server-go` 在真实启动后，是否能通过 web 当前依赖的关键 API 和 SSE 事件流支撑最小闭环。

---

## 验证方式

在 worktree 中真实启动：

```bash
env GOCACHE=/private/tmp/shipyard-go-gocache \
  SHIPYARD_WORKSPACE_DIR=/private/tmp/shipyard-go-runtime-smoke \
  go run ./cmd/api
```

然后对运行中的 Go server 发真实 localhost HTTP 请求，并打开真实 SSE 流：
- `GET /health`
- `GET /api/status`
- `POST /api/run`
- `GET /api/projects`
- `GET /api/projects/{pid}/sessions/{sid}/graph`
- `GET /api/projects/{pid}/sessions/{sid}/files`
- `GET /api/projects/{pid}/sessions/{sid}/preview`
- `GET /api/stream`
- `POST /api/runs/{sid}/checkpoints/{nodeId}/approve`

---

## 实际结果

### 1. 服务启动
结果：✅ 成功

`server-go` 可以真实启动并监听 `:8080`。

### 2. `/health`
结果：✅ 成功

返回：
```json
{"ok":true,"service":"server-go"}
```

### 3. `/api/status`
结果：✅ 成功

返回结构符合前端预期，包含：
- `isRunning`
- `canResume`
- `spec`
- `nodeCount`
- `doneCount`
- `projectId`
- `sessionId`

### 4. `/api/run`
结果：✅ 成功

成功创建：
- `projectId`
- `sessionId`
- `graphId`

且随后可以通过 `projects / graph / status` 查到对应 session。

### 5. `/api/projects`
结果：✅ 成功

成功返回 project 列表与 session 列表。

观察到：
- 新创建 session 初始状态为 `paused`
- 这是因为默认 `StaticPlanner` 第一个节点是 checkpoint

### 6. `/api/projects/{pid}/sessions/{sid}/graph`
结果：✅ 成功

成功返回前端画布所需的节点快照：
- `nodes[]`
- `title`
- `status`

初始图状态：
- `plan-1` 为 `running`
- `impl-1` 为 `pending`
- graph 为 `paused`

这与当前 runtime 语义一致。

### 7. `/api/projects/{pid}/sessions/{sid}/files`
结果：✅ 成功

在当前 session 尚未生成文件时返回：
```json
{"files":[]}
```

这对前端是安全的，不会因为接口缺失而报错。

### 8. `/api/projects/{pid}/sessions/{sid}/preview`
结果：✅ 成功

在当前 session 无静态产物时返回稳定结构：
```json
{
  "ok": true,
  "supported": false,
  "kind": "none",
  "reason": "No static preview entry found, and live preview is not yet supported by server-go.",
  "liveStatus": "idle"
}
```

这意味着 preview 面板至少不会因为接口不存在而直接失败。

### 9. `/api/stream`（最关键）
结果：✅ 成功

真实打开 SSE 后，服务端先发送：
```text
: connected
```

随后在 checkpoint approve 之后，实际收到了前端可消费的事件：
- `node_update`
- `graph_failed`

且事件中包含：
- `projectId`
- `sessionId`
- `payload.id`
- `payload.status`
- `payload.verifications`
- `payload.retryCount`
- `payload.error`

这说明：
**web 兼容 SSE 投影在运行级别是真能出事件的，不只是编译通过。**

### 10. checkpoint approve → runtime 推进
结果：✅ 成功

调用：
```http
POST /api/runs/{sessionId}/checkpoints/plan-1/approve
```

返回：
```json
{"ok":true}
```

之后 runtime 实际继续执行 `impl-1`。

### 11. implement 节点执行与失败收敛
结果：✅ 成功暴露真实行为

在默认 `StubExecutor` 下：
- executor 不会写出 `output/main.ts`
- verifier 会进行 artifact presence 校验
- 节点进入 retry
- 重试到上限后进入 `failed`
- graph 最终进入 `graph_failed`

SSE 中可以看到：
- `running`
- `ready`（retry scheduled 后）
- 多轮重试
- 最终 `failed`
- `graph_failed`

最终 graph 查询结果中可见：
- `plan-1 = done`
- `impl-1 = failed`
- `retryCount = 3`
- `verifications[0].summary` 为缺失输出文件信息

这证明：
**run → checkpoint approve → implement → verify → retry → fail → graph_failed 这条链是真实跑通的。**

---

## 这次联调证明了什么

### 已被运行级验证的能力
1. `server-go` 能真实启动并服务 HTTP
2. web 兼容 REST API 基本骨架可访问
3. run / projects / graph / status 可以形成闭环
4. checkpoint approve 能真实驱动 runtime 前进
5. SSE compat stream 能真实发出前端可消费事件
6. graph fail / retry / verification 信息能真实进入 API 与 SSE 结果

### 还没有被这次联调证明的能力
1. 真正浏览器页面接入是否完全无误
2. EventSource 在真实前端 store 中是否存在 session 切换边界问题
3. live preview 能力
4. 成功路径下的文件生成 / preview / file viewer 完整体验
5. LLM executor 成功写文件后的“成功收敛”路径

---

## 当前暴露出来的真实阻塞项

### 阻塞 1：默认 `StaticPlanner + StubExecutor` 更偏演示链路，不是可替换链路
当前真实运行会：
- 先卡在 checkpoint
- approve 后进入 implement
- implement 不产出文件
- verifier 必然失败
- 图最终失败

这说明：
**当前默认运行配置不足以支持“前端真实成功完成一个任务”。**

### 阻塞 2：`/api/status` 的 `canResume` 语义仍偏松
在失败/暂停场景下，`canResume` 仍可能为 `true`。
这未必是错，但需要和前端 resume 条件再做一次语义对齐。

### 阻塞 3：preview 仍只有静态/unsupported 兼容
接口可用，但 live preview 还不具备 TS 版能力。

### 阻塞 4：联调已证明“失败路径”很强，但“成功路径”还未被真实验证
目前能证明的是：
- 状态机和 SSE 在失败路径上是活的

但还不能证明：
- 一个任务能真实成功写出文件
- files/preview/UI 在成功结果上是通的

---

## 当前结论

这次运行级 smoke 的结论是：

### 好消息
`apps/server-go` 已经不再只是“编译上兼容 web”。
它已经可以在真实启动后，跑通下面这条关键链路：

```text
run
→ status / projects / graph
→ checkpoint approve
→ implement
→ verify
→ retry
→ graph_failed
→ SSE 实时推送
```

这说明它的：
- runtime
- persistence
- compat REST
- compat SSE

已经具备了**真实联调价值**。

### 但仍未达到“可替换 TS 后端”
核心原因仍是：
1. 默认成功路径未打通
2. live preview 未完成
3. 真正前端页面联调还没做
4. session-scoped 文件模型还未收敛

所以当前状态应定义为：

- **已通过一轮真实运行级 smoke**
- **具备继续做前端联调和成功路径验证的条件**
- **仍不能合并到 `main` 作为默认替代后端**

---

## 建议的下一步

优先级建议：

1. **打通一个真实成功路径**
   - 不要求全功能，但至少要让一个 session 能成功产出文件并通过 verify
   - 这是进入“可替换”讨论前必须补的证据

2. **做一次真正的 web 页面联调**
   - 用 `apps/web` 实际连 `server-go`
   - 验证 status / graph / stream / files / preview 面板行为

3. **收敛默认执行模式**
   - 当前 `StaticPlanner + StubExecutor` 更像演示链路
   - 要进入替换评估，默认路径至少需要更接近真实 executor


---

## 第二阶段：默认成功路径验证（D 方向）

在完成默认 no-LLM 成功路径改造后，又做了一轮真实运行级验证。

### 这轮改造点
- `StaticPlanner` 不再默认插入 checkpoint
- 默认产物改为 `output/index.html`
- 默认 fallback executor 不再是“什么都不写”的 stub，而是一个 deterministic executor
- deterministic executor 会真实写出静态 HTML 原型文件
- verifier 会对该产物做 artifact presence + 基础 lint 跳过校验

### 成功路径联调结果
真实调用：
```http
POST /api/run
{"spec":"build a pricing page with hero and faq"}
```

随后在 **SSE 已连接** 的情况下，真实收到了：
- `log: session.created`
- `log: graph.initialized`
- `node_update`（impl-1 running）
- `graph_done`

其中 `graph_done` 的真实 payload 包含：
- `id`
- `title`
- `status: done`
- `stats.filesGenerated = 1`
- `stats.verificationsPassed = 2`
- `stats.verificationsRun = 2`

### 成功产物验证
真实查询结果表明：

#### 1. graph
```json
{
  "status": "done",
  "nodes": [
    {
      "id": "impl-1",
      "status": "done",
      "filesWritten": ["output/index.html"],
      "toolCalls": [{"tool":"write_file","success":true}],
      "verifications": [
        {"type":"artifact","passed":true},
        {"type":"lint","passed":true}
      ]
    }
  ]
}
```

#### 2. files
```json
{
  "files": [
    {"path":"output/index.html"}
  ]
}
```

#### 3. preview
```json
{
  "ok": true,
  "supported": true,
  "kind": "static",
  "entryPath": "output/index.html"
}
```

这说明默认 no-LLM 路径已经可以真实跑通：

```text
run
→ implement
→ write_file
→ verify passed
→ graph_done
→ files 可见
→ preview 可读
→ SSE 发出 graph_done
```

### 这次成功路径验证证明了什么
1. Go backend 现在不只会“失败收敛”，也能“成功收敛”
2. web 所依赖的 graph/files/preview/SSE 在成功路径上都已有真实证据
3. 默认 fallback 模式已经从“演示用失败链路”提升到“可作为 smoke 成功目标的最小真实链路”

### 仍然存在的问题
1. 这个成功路径仍然是 deterministic/static prototype，不是完整智能实现
2. live preview 仍未实现
3. 浏览器页面级联调仍未做
4. `/api/status` 当前更偏“resume target”语义，成功 run 完成后不一定会指向最新成功 session

### 更新后的判断
D 方向完成后，`apps/server-go` 已经同时具备：
- 真实失败闭环证据
- 真实成功闭环证据

这比之前更接近“可替换标准”，但仍不能直接替换 TS 默认后端，因为：
- 页面级联调还没做
- live preview 还没做
- 成功路径还是 deterministic fallback，不是完整生产实现


---

## 第三阶段：web dev server 页面接线路径验证（E 方向）

在 D 方向完成后，又做了一轮 `apps/web -> server-go` 的页面接线路径联调。

### 准备动作
1. 将 `apps/web/vite.config.ts` 的 `/api` 代理改为可配置：
   - 默认仍指向 `http://localhost:5174`
   - 可通过 `SHIPYARD_WEB_API_PROXY_TARGET` 覆盖

2. 真实启动：

```bash
# server-go
env GOCACHE=/private/tmp/shipyard-go-gocache   SHIPYARD_WORKSPACE_DIR=/private/tmp/shipyard-go-runtime-success-smoke   go run ./cmd/api

# web
env SHIPYARD_WEB_API_PROXY_TARGET=http://127.0.0.1:8080   pnpm --dir apps/web dev --host 127.0.0.1 --port 5173
```

这意味着 web 页面 origin `http://127.0.0.1:5173` 下的 `/api/*` 已经真实代理到 `server-go`。

### 已验证的页面接线路径能力

#### 1. web 页面可访问
结果：✅

真实访问 `http://127.0.0.1:5173/` 能返回 Vite 页面入口 HTML。

#### 2. web origin 下的 `/api/status`
结果：✅

从 `5173/api/status` 返回了来自 `server-go` 的真实 JSON，证明 Vite proxy 已接通。

#### 3. web origin 下的 `/api/run`
结果：✅

从 `5173/api/run` 成功创建新的 session，说明页面代码实际使用的 API 路径已经可通到 Go backend。

#### 4. web origin 下的 `/api/projects / graph / files / preview`
结果：✅

通过 `5173` 访问这些接口，真实收到了：
- done 的 graph
- `output/index.html` 文件列表
- static preview 状态

这证明：
**页面层看到的 project/graph/files/preview 数据链路已经接上 Go backend。**

#### 5. web origin 下的 `/api/stream`
结果：✅

真实打开：
```text
http://127.0.0.1:5173/api/stream
```

在 stream 已连接的情况下，再通过 `5173/api/run` 发起新任务，真实收到了：
- `log: session.created`
- `log: graph.initialized`
- `node_update`
- `graph_done`

其中最后一个 `node_update` 已包含：
- `filesWritten`
- `toolCalls`
- `verifications`

这说明：
**不仅 8080 上的 Go SSE 能工作，而且 web 页面 origin（5173）下通过 Vite proxy 的 `/api/stream` 也能实时工作。**

### 这轮 E 验证证明了什么
1. `apps/web` 当前的 API 调用路径可以接到 `server-go`
2. `apps/web` 当前的 SSE 路径可以接到 `server-go`
3. 页面所依赖的核心读取接口（status/projects/graph/files/preview）在 web origin 下是通的
4. 成功路径的 realtime 事件在页面 origin 下也是真实可达的

### 还没有做到的部分
这轮 E 方向完成的是：
- **页面接线路径联调**

但还没有做到：
- 真浏览器里人工点击按钮逐步操作 UI
- 真正观察 React store / Canvas / PreviewPanel 的视觉行为
- 验证 session 切换时页面状态是否完全正确

也就是说，当前已经不是“只有后端 curl 测试”，但仍未达到完整的手工/浏览器交互验收。

### 更新后的判断
E 方向完成后，可以更有把握地说：

- `apps/web` 的 **网络接线层** 已经基本能接 `server-go`
- 成功/失败路径的 REST + SSE 都已有真实证据
- 剩下更大的不确定性，已经收缩到：
  1. 真实 UI 行为细节
  2. live preview
  3. session-scoped 文件模型
  4. 非 deterministic 的生产级默认执行能力


---

## 追加验证：crash / restart recovery smoke（2026-05-15）

### 目的

验证本轮新增的 runtime recovery 不是单测层面的“可恢复设计”，而是在真实进程中断后，`server-go` 重启时可以：

1. 扫描活动 session
2. 从 graph snapshot 恢复 runtime
3. 对中断前处于执行中的 session 自动继续推进
4. 最终收敛到完成状态

### 验证方法

准备一个临时 repo：

```json
{
  "scripts": {
    "build": "node -e "setTimeout(() => process.exit(0), 10000)""
  }
}
```

这样 verifier 的 `pnpm run build` 会稳定耗时约 10 秒，便于在 `node.verifying` 阶段主动杀掉 `server-go` 进程。

随后执行：

1. 启动 `server-go`
2. `POST /api/run`，并传入 `repoPath=/private/tmp/shipyard-go-recovery-repo`
3. 拿到：
   - `projectId = proj-1778830915107`
   - `sessionId = sess-1778830915107`
4. 在 run 过程中直接 `Ctrl-C` 杀掉 Go 服务
5. 重新启动 `server-go`
6. 查询 `/api/status`、`/api/projects`、`/api/projects/{pid}/sessions/{sid}/graph`、`/api/sessions/{sid}`

### 实际结果

#### 1. 重启后 session 被自动恢复
结果：✅

重启后：
- `/api/projects` 中该 session 仍存在
- `/api/status` 指向该最新 session
- runtime 命令路径未出现“runtime not found”级故障

#### 2. 被中断的 run 在重启后继续完成
结果：✅

关键证据来自 `/api/sessions/sess-1778830915107`：

- `node.verifying` 事件时间：`2026-05-15T07:41:55.109478Z`
- `compile` / `pnpm run build` 验证完成时间：`2026-05-15T07:42:05.396571Z`
- `node.completed` 事件：`2026-05-15T07:42:05.396586Z`
- `graph.completed` 事件：`2026-05-15T07:42:05.397388Z`

而 Go 进程是在 run 中途被手动中断后才重启的，因此：

**`graph.completed` 明确发生在重启之后。**

这证明：
- session runtime 确实被恢复了
- 被中断前处于 active 状态的节点并非永久卡死
- 恢复后的 runtime 能继续推进并最终完成

#### 3. 恢复后的最终状态一致
结果：✅

重启后查询到：
- session status = `done`
- graph status = `done`
- node `impl-1` = `done`
- verifications 中保留了 `artifact` + project-aware `compile` 记录

### 这次 recovery smoke 证明了什么

本轮 recovery 改造已经不只是：
- 有 snapshot
- 有恢复代码
- 有单元测试

而是已经被真实运行级验证为：

```text
run
→ node.verifying
→ process crash
→ restart server-go
→ restore runtime from snapshot
→ continue verification / completion
→ graph_done
```

### 仍未被这次验证覆盖的内容

1. paused checkpoint 场景下的 restart + approve 联调
2. failed session 重启后的 retry 命令闭环
3. browser 页面在 crash/restart 后是否能无缝重新接收 `/api/stream`
4. 多 session 并发恢复时的行为

### 对“是否可替换”的影响

这次验证显著降低了一个关键阻塞项：

- recovery 已从“设计上可做”推进到“运行级已证明主链路成立”

但即使如此，**仍不能单凭这次结果认定 Go 后端已经可替换 TS 后端**。

剩余主要阻塞仍然是：
1. 真实前端页面交互验收
2. live preview 缺失
3. 多场景恢复（checkpoint / failed / retry）的运行级补充验证
4. rollout / rollback runbook 未完成


### 追加验证：recovered paused / failed session command handling（2026-05-15）

在 crash/restart recovery smoke 完成后，继续对两类“恢复后的旧 session”做真实命令联调：

#### 1. paused checkpoint session 在重启后仍可 approve
结果：✅

对旧 paused session：
- `projectId = proj-1778753529740`
- `sessionId = sess-1778753529740`

执行：
```http
POST /api/runs/sess-1778753529740/checkpoints/plan-1/approve
```

返回：
```json
{"ok":true}
```

随后 graph 从：
- `plan-1 = running`
- `impl-1 = pending`
- `graph = paused`

推进到：
- `plan-1 = done`
- `impl-1 = done`
- `graph = done`

这证明：
**重启恢复后的 paused checkpoint runtime 可以继续接收 approve 命令并完成后续执行。**

#### 2. failed session 在重启后仍可 retry 并重新收敛
结果：✅（修复后复验通过）

对旧 failed session：
- `projectId = proj-1778814513258`
- `sessionId = sess-1778814513258`

第一次复验时暴露出一个真实 bug：
- `/api/session/retry` 返回 `ok:true`
- 但 failed graph 没有真正重新推进

随后修复：
- `NodeCompatService.RetrySession` 改为对 failed / blocked nodes 发送 `RetryNodeCommand`
- `SessionRuntime` 中 `RetryNodeCommand` 会把 session status 和 graph status 一并恢复到 `running`

修复后再次真实验证：
```http
POST /api/session/retry
```

返回：
```json
{"ok":true,"graphId":"graph-1778814513258","projectId":"proj-1778814513258","sessionId":"sess-1778814513258"}
```

随后 graph 实际推进到：
- `impl-1 = done`
- `graph = done`

这证明：
**重启恢复后的 failed session 不仅能接收 retry 命令，而且 retry 后能真实重新收敛。**

### 更新后的恢复结论

至此，恢复相关的三条关键运行级链路都已有真实证据：

1. `running/verifying` 中断后，重启可自动继续完成
2. `paused checkpoint` 重启后可继续 approve 并完成
3. `failed session` 重启后可 retry 并重新收敛

这使得 recovery 相关阻塞项显著缩小。当前恢复能力已不再只是“具备基础骨架”，而是已经接近 **replaceable backend** 所需的真实控制流强度。
