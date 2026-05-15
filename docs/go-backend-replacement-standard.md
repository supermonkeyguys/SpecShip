# Go 后端替换 TS 后端的验收标准

> 更新（main）：当前仓库开发默认后端已切到 `apps/server-go`，`apps/server/src` 继续保留为 TS fallback。本文保留的是风险、验收和回滚视角，不代表 TS 已被删除。

> 目标：只有当 `apps/server-go` 达到以下 **替换标准** 时，才允许将其作为主线后端并合并进入 `main`。
>
> 这份标准强调的是 **可替换**，不是“技术预研完成”或“架构方向正确”。

## 1. 合并门槛定义

要允许 Go 后端替换当前 TS 后端，必须同时满足：

1. **接口兼容**：当前 web / 调度链路依赖的核心 API 与事件模型可以直接接入，或已有明确 adapter 且已验证。
2. **执行闭环可用**：planner → executor → verifier → retry / checkpoint / resume 全链路可稳定工作。
3. **项目级验证可靠**：不只是文件存在或语法检查，而是能优先跑真实项目命令（如 `pnpm lint/test/build`、`npm run build`、`go test ./...`）。
4. **状态恢复可靠**：进程重启后 session / graph / events / snapshot 可恢复，且不会破坏一致性。
5. **观测与调试可用**：前端或运维能看到节点状态、工具调用、验证记录、失败原因、事件流。
6. **回滚明确**：切换到 Go 后端的发布方案支持快速回退到 TS 后端。

只要有任一项未达标，就不能定义为“可替换”，也不应直接合并到 `main` 作为替代实现。

---

## 2. 必须达标的能力清单

### A. HTTP / API 兼容性（硬门槛）

Go 后端需要覆盖当前产品主流程实际依赖的接口能力，至少包括：

#### A1. 运行控制
- 创建运行 / 启动 session
- resume session
- retry node
- approve checkpoint
- 查询 project / session / graph 当前状态
- 事件流订阅（SSE replay + live）

#### A2. 前端当前依赖的辅助接口
若 web 仍依赖以下能力，则 Go 端必须提供同等能力或提供 adapter：
- 生成 PRD
- clarify / 规格澄清
- chat / 意图识别
- 单节点 verify
- 单节点 edit
- 单节点 retry 的兼容路径

#### A3. 响应与事件契约
- event type 稳定且前端可消费
- sessionId / projectId / graphId / nodeId 的结构稳定
- 错误响应结构稳定（`error`, `code`, `message` 等）

**验收标准**
- Web 在不改或只做极薄 adapter 的前提下可切换到 Go 后端。
- 核心用户路径可完整跑通。

---

### B. Runtime / Orchestration（硬门槛）

#### B1. 图执行能力
- planner 能生成合法 graph
- implement node 可执行
- checkpoint node 可暂停并等待人工确认
- downstream dependency 解锁正确
- 完成 / 失败状态收敛正确

#### B2. 失败恢复能力
- verify 失败可重试
- fatal 失败与 verify 失败能区分
- retry 次数和失败原因可追踪
- graph fail / session fail 一致

#### B3. 重启恢复能力
- graph snapshot 足够恢复 runtime 状态
- event log 能回放
- 进程中断后能重建 session runtime

**验收标准**
- 在“成功 / verify 失败 / fatal 失败 / checkpoint 暂停 / 恢复继续”五类场景下行为一致。

---

### C. Executor（硬门槛）

#### C1. 多步工具执行
- 至少支持：`read_file` / `search_files` / `write_file` / `run_command`
- 不再依赖单次整文件生成作为唯一执行模式
- 能利用历史 observation 修复上一步错误

#### C2. 写入安全
- 只能写到 node 允许的 outputs
- command workDir 不能逃逸 workspace
- 工具调用都有 evidence 记录

#### C3. 自动修复闭环
- 写入后可自动触发验证
- finish 前必须强制验证
- 验证失败结果会回灌到下一轮执行

**验收标准**
- 至少一类真实任务可以在“写文件 → 自动验证失败 → 修复 → 再验证通过”的闭环里稳定完成。

---

### D. Verifier（硬门槛）

#### D1. 确定性验证
- 产物存在性检查
- 语言级 compile / syntax check
- lint（可配置软/硬失败）
- test / build / project command 验证

#### D2. 项目级验证优先
如果输出文件属于真实项目目录，则应优先使用项目命令，而不是只用文件后缀推断：
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- `npm run lint/test/build`
- `go test ./...`

#### D3. reviewer / acceptance 审核
- 可选 reviewer LLM
- acceptance 不满足时给出可用于修复的 blocking summary

**验收标准**
- 至少在 JS/TS 项目与 Go 项目上能跑通真实项目级验证。

---

### E. Persistence / Streaming（硬门槛）

- projects / sessions / events / graph snapshots 落库
- SSE 支持历史 replay + 实时订阅
- revision 单调递增且不丢事件
- 前端能稳定根据事件流更新状态

**验收标准**
- 页面刷新后可回放 session 历史。
- live 事件流与数据库记录一致。

---

### F. Frontend Integration（硬门槛）

如果目标是“替换现有后端”，则需要保证：

- web 端能查询 project / session / graph
- log panel 能展示 tool calls / verifications / files written / errors
- checkpoint 流程前端可感知并继续
- retry / resume / approve 操作打通
- 前端当前依赖的接口若不兼容，必须有明确 adapter 层并实测通过

**验收标准**
- 至少一个完整前端任务流程可连接 Go 后端跑通。

---

### G. 迁移 / 上线（硬门槛）

- 支持 feature flag 或环境切换
- 可以按 project/session 灰度切换后端
- 明确回滚到 TS 后端的步骤
- 有最小运行手册（runbook）

**验收标准**
- 切换失败时可以快速回退，不损坏现有用户数据。

---

## 3. 当前状态评估（2026-05-15）

### 已具备
- Go 控制面基础架构已成型
- SQLite 持久化已存在
- session runtime / graph / event / snapshot 已存在
- planner / executor / verifier 已有实现
- executor 已支持多步工具循环
- executor 已支持自动验证回灌闭环
- SSE replay + live 已存在
- `go build ./...` 可通过

### 未达“可替换”的关键阻塞项

#### 阻塞 1：最终前端交互验收仍缺失
接口兼容层当前已经大幅补齐，`/api/chat`、`/api/prd`、`/api/clarify`、`/api/node/:id/verify`、`/api/node/:id/edit` 与 web 主路径相关接口已经具备。

但仍缺少 **真实页面交互级** 验收，因此还不能把“接口已具备”直接等同于“产品可替换”。

#### 阻塞 2：项目级验证仍不够完整
虽然 Go verifier 已支持 compile / lint / go test 等，但仍需加强：
- 自动发现 package root
- 自动识别包管理器与 scripts
- 优先执行真实项目命令
- 避免只靠文件后缀推断

#### 阻塞 3：恢复与冷启动重建仍未完成运行级验收
- 启动时扫描活动 session 并恢复 runtime 已落地
- 已新增 recovery 级单测，覆盖 snapshot 恢复时的节点状态归一化
- 已完成真实 crash/restart 运行级联调，并补验证了 paused checkpoint approve 与 failed session retry 的恢复后命令闭环
- 仍缺少更多并发/浏览器侧恢复联调，但主恢复链路已明显增强

#### 阻塞 4：前端集成验证缺失
- 还没有用现有 web 前端完整接到 Go 后端跑完主流程
- 因此前端兼容性仍停留在代码级推断，不是实测通过

#### 阻塞 5：迁移与回滚方案未成体系
- 还没有 feature flag / adapter / rollout runbook
- 因此即使技术上能跑，也不能安全切主

---

## 4. 达标后才允许的操作

只有当以下条件同时成立，才允许合并到 `main` 作为替代主线：

- [ ] API 兼容层完成并验证
- [ ] 至少一个真实前端主流程对接 Go 后端跑通
- [ ] repo-aware verifier 跑通真实项目命令
- [ ] session crash/restart 恢复验证通过
- [ ] rollout / rollback runbook 已写明
- [ ] 有明确开关允许从 TS 回退

在上述条件未全部满足前，Go 后端应继续以：
- spike
- experimental app
- shadow mode
- feature-flag backend

的身份存在，而**不能**直接替换 TS 后端成为 `main` 默认实现。

---

## 5. 当前执行策略

基于现状，下一步优先级应为：

1. **repo-aware 项目级验证**
2. **前端依赖 API 兼容层 / adapter**
3. **runtime crash-recovery 验证**
4. **切换与回滚 runbook**

在这些完成之前，不进行合并 `main` 的替代性切换。
