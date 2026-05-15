# Go 后端前端接入缺口清单

> 更新（main）：当前仓库开发默认后端已切到 `apps/server-go`，`apps/server/src` 继续保留为 TS fallback。本文保留的是风险、验收和回滚视角，不代表 TS 已被删除。

> worktree: `/private/tmp/shipyard-go-spike`
> branch: `feat-go-backend-spike`
> date: 2026-05-15

## 目标

这份清单只回答一个问题：**当前 `apps/server-go` 距离被现有 `apps/web` 直接接上，还差哪些接口与验证。**

它不是“是否架构更优”的讨论，而是 **web 兼容与替换风险列表**。

---

## 一、已补齐/已具备的前端兼容接口

### 1. 运行与状态
- `GET /api/status`
- `POST /api/run`
- `POST /api/resume`
- `POST /api/session/retry`
- `POST /api/node/:id/retry`
- `POST /api/node/:id/verify`
- `POST /api/node/:id/edit`

### 2. 图与项目查询
- `GET /api/projects`
- `GET /api/projects/{projectId}/sessions/{sessionId}/graph`
- `GET /api/sessions/{sessionId}`
- `DELETE /api/projects/{projectId}` ✅ 本轮新增
- `DELETE /api/projects/{projectId}/sessions/{sessionId}` ✅ 本轮新增
- `PATCH /api/projects/{projectId}/sessions/{sessionId}` ✅ 本轮新增（starred）

### 3. 规格辅助
- `POST /api/prd`
- `POST /api/clarify`
- `POST /api/chat`
- `POST /api/plan` ✅ 本轮新增

### 4. 文件查看
- `GET /api/projects/{projectId}/sessions/{sessionId}/files` ✅ 本轮新增
- `GET /api/projects/{projectId}/sessions/{sessionId}/file?path=...` ✅ 本轮新增

### 5. Preview
- `GET /api/projects/{projectId}/sessions/{sessionId}/preview` ✅ 本轮新增（静态 preview 状态）
- `POST /api/projects/{projectId}/sessions/{sessionId}/preview/live/start` ✅ 本轮新增（稳定 unsupported 兼容响应）
- `POST /api/projects/{projectId}/sessions/{sessionId}/preview/live/stop` ✅ 本轮新增（稳定 unsupported 兼容响应）
- `GET /api/projects/{projectId}/sessions/{sessionId}/preview/content/...` ✅ 本轮新增（静态内容读取）

### 6. 实时事件
- `GET /api/stream`
  - 支持旧模式：`sessionId + afterRevision`
  - 支持 web 兼容模式：无 `sessionId` 时投影为前端期望的 `node_update / graph_done / graph_failed / log`

---

## 二、本轮新增验证结果

### 已验证
1. `go test ./internal/transport/http/handlers` 通过
   - 验证了 `/api/plan` 返回 plan markdown
   - 验证了 `/api/projects/.../files`
   - 验证了 `/api/projects/.../file?path=...`
   - 验证了 `/api/projects/` 前缀下 graph/file 路由分发

2. `go build ./...` 通过

3. 真实运行级 smoke 已完成
   - 真实启动了 `server-go`
   - 真实验证了 `run -> projects/graph -> checkpoint approve -> SSE -> graph_failed` 失败闭环
   - 真实验证了默认成功路径 `run -> graph_done -> files -> preview -> SSE` 成功闭环

4. preview handler 级验证通过
   - 验证了静态 preview 状态接口
   - 验证了 preview HTML 内容返回与资源路径重写
   - 验证了 live preview start 在 Go 端当前会稳定返回 unsupported 而不是接口缺失

5. project/session mutation handler 级验证通过
   - 验证了 session starred patch
   - 验证了 session delete
   - 验证了 project delete
   - 验证了删除时会尝试停止对应 runtime

### 仍未验证
- 真实浏览器 `EventSource` 消费 `/api/stream`（已通过 web dev server 5173 的 `/api/stream` 验证代理链路与实时事件，但还不是人工浏览器交互验收）
- 真实 web 前端连到 Go backend 后的完整页面交互行为
- 文件列表是否在复杂 session 场景下满足复杂多 session 场景预期

> 当前文件/preview/verify 的根目录策略已收敛为：
> - 若 run 提供 `repoPath`，则优先以目标 repo 目录作为执行与校验根
> - 若未提供 `repoPath`，则退回 `workspace/sessions/<sessionId>` 作为 session 级工作目录
> - files / preview / node verify 与 runtime executor 现已使用同一套根目录解析逻辑
>
> 这比早期“全局 workspace 兼容视图”更接近替换级后端，但仍需真实 UI 多 session 场景验收。

---

## 三、剩余明显缺口

### A. Preview 仍未完全达标
当前已完成：
- 静态 preview 状态查询
- 静态 preview 内容读取
- live preview start/stop 的稳定兼容响应

当前仍缺：
- 真正的 live preview 进程管理
- live preview proxy / HMR / dev server 转发
- 真实前端 iframe 联调验证

影响：
- 对纯静态输出，preview 面板已有望可用
- 对需要 dev server 的 React/Vite/Next 输出，当前只能稳定告诉前端“暂不支持 live”，还不能达到 TS 版本能力

### B. `/api/stream` 已通过运行级 smoke 和页面接线路径联调，但未完成最终浏览器交互验收
当前已验证：
- 真实打开 `/api/stream` 能收到连接响应
- checkpoint approve 后能收到 `node_update` / `graph_failed` 等兼容事件
- 默认成功路径下能收到 `node_update` / `graph_done`
- 通过 web dev server 5173 的 `/api/stream` 代理也能收到 realtime 事件
- runtime 的 retry / fail 过程会真实投影到 compat SSE

但仍需验证：
- 前端 store 是否在真实页面交互下完全正确消费字段
- 切换 session 时是否会出现旧事件串流
- 浏览器 EventSource 断开重连后的行为是否符合预期

### C. 执行根目录已明显收敛，但仍需真实多 session/UI 验收
当前已完成：
- runtime executor / verifier / node verify / files / preview 使用统一 execution root
- `repoPath` 优先走真实项目目录
- 无 `repoPath` 时退回 `workspace/sessions/<sessionId>`

当前仍缺：
- 真实页面下的多 session 切换与文件/preview 面板稳定性验收
- 更进一步的工作目录初始化/清理策略（尤其是 repoPath 为空时）

### D. 真实前端主流程尚未完成最终交互验收
同时，虽然本轮已补上“服务启动时自动恢复活动 session runtime”的恢复骨架，并新增了 recovery 回归测试，但仍未完成真正的 crash/restart 运行级联调验收。
当前已经做过：
1. 运行级 smoke（直接访问 Go server）
2. 页面接线路径联调（通过 web dev server 5173 的 `/api/*` 代理访问 Go server）

已经确认：
1. web 发起的 `/api/run` 路径可接到 Go backend
2. status / projects / graph / files / preview 在页面 origin 下可访问
3. 浏览器 origin 下的 `/api/stream` 代理可收到 realtime 事件
4. 默认成功路径可真实进入 graph_done

但仍缺少最终的人工/浏览器交互验收：
1. 真正观察 Canvas 是否按预期刷新
2. node detail 是否完整显示 toolCalls / verifications / filesWritten
3. files / preview 面板的实际 UI 行为
4. retry / resume / checkpoint approve 是否在真实 UI 点击中完全闭环
5. session 切换时页面状态是否稳定

在这一步完成之前，还不能说“可替换”。

---

## 四、替换前建议优先级

### P1：补 preview 兼容接口
最少做法：
- 返回稳定结构 `{ ok, supported, kind, reason }`
- 即使暂不支持 live preview，也要让前端不报错

### P2：做一次真正的 web 页面联调
建议方式：
- 本地把 web API base 指到 Go backend
- 复用已经通过的运行级 smoke 路径
- 重点验证页面中的 `/api/stream`、workspace/files/preview 面板和 session 切换

### P3：收敛文件存储模型
把以下三者统一：
- executor 写文件位置
- verifier 校验根目录
- files API 暴露目录

目标是形成**明确的 session 工作目录模型**。


---

## 五、当前结论

`apps/server-go` 的 web 兼容性已经从“接口缺一大片”推进到“主流程基本骨架已具备”。

但截至当前，**仍不能认定为可替换 TS 后端**，主要原因是：
1. preview 目前仅达到“静态可用、live 未支持”的阶段
2. 文件能力目前是兼容方案，不是最终隔离模型
3. 还没有完成最终浏览器交互级验收

所以当前状态应定义为：

- **可以继续作为 experimental backend 快速推进联调**
- **还不能合并到 `main` 作为默认替代后端**
