# Shipyard 问题沉淀与决策记录

> 记录开发过程中遇到的真实问题、根本原因和解决方案。
> 目的：快速理解历史意图、避免重复踩坑、为后续扩展提供上下文。

---

## 目录

1. [执行引擎 — 节点质量](#1-执行引擎--节点质量)
2. [Review 层问题](#2-review-层问题)
3. [前端状态管理](#3-前端状态管理)
4. [Chat / 意图路由](#4-chat--意图路由)
5. [会话管理](#5-会话管理)
6. [可观测性](#6-可观测性)
7. [已知待解决问题](#7-已知待解决问题)

---

## 1. 执行引擎 — 节点质量

### 1.1 文件被截断导致代码不完整（高频）

**现象**
节点 review 报 `file is truncated / missing closing braces`，代码写到一半结束。

**根本原因**
LLM 单次输出有 token 上限。当一个节点对应的文件包含多个组件 + 样式对象时（如 `FeaturedArticlesSection.tsx` 含 `FeaturedArticlesSection` + `ArticleCard` + 样式），很容易超出。

**案例**
```
proj-1777630873286 / sess-1777630873287
节点: impl-featured-articles-section
第5次retry仍失败：code truncated at imageLabelStyle object
```

**解决方案**（已实施/待实施）
- ✅ `maxRetries` 从 2 改为 5，增加自动修复机会
- ✅ `lastErrorKind` 区分 fatal/verify/review，retry 时保留上次代码供 LLM 参考
- ⬜ **Planner prompt 加"单文件行数/职责限制"**：每个节点只实现一个组件/类/函数集合，禁止在一个文件里堆多个独立组件

**Planner 规则（待加入 prompt）**
```
- One file = one responsibility: one component, one class, or one cohesive set of functions
- If a step would require >100 lines, split into multiple steps
- UI components: each component gets its own file (no co-located sub-components in same file)
```

---

### 1.2 Review 标准错误（已修复）

**现象**
review 用整个项目的需求来评判单个节点，types 文件被判"没有实现完整博客"。

**根本原因**
- `acceptanceCriteria` 在 Planner 阶段生成，但依赖文件还没写出来，只能猜测
- reviewer 收到模糊的 criteria 后自行推断，使用全局视角评判

**解决方案**（已实施）
- `REVIEWER_PROMPT` 明确限制：只对照 `acceptanceCriteria`，禁止跨节点评判
- `acceptanceCriteria` fallback 改为：`"SCOPE: Review ONLY this file. Check compile + title compliance. Do NOT require other files."`
- 执行前 + review 前从依赖文件静态提取导出符号，追加到 `acceptanceCriteria`，避免符号名对不上

---

### 1.3 Planner task 粒度过粗（已改进，持续优化）

**现象**
task 写成"实现用户服务层"，LLM 自由发挥，生成的代码和 reviewer 期望对不上。

**解决方案**（已实施）
- Planner prompt 要求 task 写到函数/接口签名级别
- 示例 good: `"Implement UserService class with: createUser(data: CreateUserDto): Promise<User>. Import User from output/types.ts."`
- 示例 bad: `"Implement user service layer"`

---

### 1.4 旧 session graph 字段缺失（已修复）

**现象**
`nodeRole`/`task`/`acceptanceCriteria` 在旧 session 的 graph.json 中为 `undefined`，reviewer 收到字符串 `"undefined"` 后用全局视角评判。

**解决方案**（已实施）
`review.ts` 加了多层 fallback，`undefined` 时生成有约束力的兜底 criteria。

---

### 1.5 Reviewer 过度严苛 — 把合法代码判为 blocking（已修复）

**现象**
`FeaturedArticlesSection.tsx` compile ✅，但 review 报3个 blocking：
1. `./globalStyles` 相对路径"不对"（应该用 `output/globalStyles.ts`）
2. ArticleCard fallback 代码"不符合 prop shape"
3. empty-state 分支"违反契约"

**根本原因**
Reviewer 不了解执行环境，把合法的相对路径判为错误；把防御性代码和 acceptanceCriteria 里没有禁止的实现细节判为 blocking。

**解决方案**（已实施）
在 `REVIEWER_PROMPT` 末尾加明确禁止规则：
- 相对路径（`./types`、`./globalStyles`）如果 compile 通过则不是 blocking
- 空状态处理、null check、fallback 等防御性代码不是 blocking
- acceptanceCriteria 未明确禁止的实现细节只能放 warnings

**文件**: `packages/core/src/ai/prompts.ts` → `REVIEWER_PROMPT`

---

### 1.7 LLM 误解 verify 错误，将 import 路径改为带 .tsx 扩展名（已修复）

**现象**
`TS5097: import path can only end with '.tsx' when allowImportingTsExtensions is enabled`
LLM 在 retry 时看到 `TS6142: --jsx not set`，误以为加上 `.tsx` 扩展名可以解决，结果把 `'./AboutSection'` 改成了 `'./AboutSection.tsx'`，触发新错误。

**根本原因**
1. verify tsc 命令缺少 `--allowImportingTsExtensions`（允许 import 时带 `.tsx`）
2. Implementer prompt 未明确禁止 import 路径带扩展名
3. `--allowImportingTsExtensions` 需要 `--moduleResolution bundler` 才能启用

**解决方案**（已实施）
- `verify.ts`: tsc 命令加 `--allowImportingTsExtensions --moduleResolution bundler`（同时替换原来的 `node`）
- `IMPLEMENTER_PROMPT`: 加规则 `Import paths MUST NOT include file extensions — write './Foo' not './Foo.tsx'`

**文件**:
- `packages/core/src/verification/verify.ts`
- `packages/core/src/ai/prompts.ts`

---

### 1.8 LLM 使用 `JSX.Element`，React 19 已移除全局 JSX namespace（已修复）

**现象**
`TS2503: Cannot find namespace 'JSX'`
代码里写了 `function App(): JSX.Element`，但全局 `JSX` 命名空间不存在。

**根本原因**
React 19 的 `@types/react` 彻底移除了全局 `JSX` namespace，改为 `React.JSX`。
`JSX.Element` 是 React 18 及以前的写法，React 19 不再支持。

**重要结论**
这是代码问题，不是 tsc 配置问题。无论如何配置 `typeRoots`/`jsx` 模式，全局 `JSX` namespace 在 React 19 里就是不存在的。

**解决方案**（已实施）
在 `IMPLEMENTER_PROMPT` 里加规则：
`For React JSX return types, use 'React.JSX.Element' or 'React.ReactElement' — NEVER use 'JSX.Element' (removed in React 19)`

**文件**: `packages/core/src/ai/prompts.ts` → `IMPLEMENTER_PROMPT`

---

### 1.6 verify 的 tsc 命令缺少 --jsx 标志（已修复）

**现象**
`App.tsx` 编译失败：`TS6142: Module './AboutSection' was resolved to '...tsx', but '--jsx' is not set.`
代码本身正常，但 verify 阶段因编译器配置缺失而失败。

**根本原因**
`packages/core/src/verification/verify.ts` 中的 tsc 命令缺少 `--jsx react` 标志。
编译 `.tsx` 文件时必须显式指定 JSX 转换选项，但原命令中没有。

**解决方案**（已实施）
检测到输出文件中包含 `.tsx` 文件时自动附加 `--jsx react` 标志。

**文件**: `packages/core/src/verification/verify.ts`

---

### 1.9 tester 节点缺少独立执行环境（待实施）

**现象**
`test-smoke-render` 节点 compile 失败：
`TS2307: Cannot find module '@testing-library/react' or its corresponding type declarations.`
verify 通过 tsc 编译检查，而测试文件依赖 `@testing-library/react`，该包在 output 目录和 shipyard monorepo 中均未安装。

**根本原因（三层）**

1. **直接原因**：`@testing-library/react` 未安装，tsc 找不到类型声明
2. **设计缺陷**：`verify.ts` 对所有节点类型（types/implementer/tester）使用同一套 compile check 逻辑，不区分 `nodeRole`。tester 节点的测试文件依赖外部测试框架是完全合理的，但当前 verify 直接对它做 tsc 编译并失败
3. **架构缺陷**：output 目录是无 `node_modules`、无 `package.json` 的纯文件集合。tester 节点的测试文件本质上需要一个可以安装依赖并实际运行的隔离环境，当前架构完全没有提供这个能力

**影响**
- 所有依赖外部测试框架（@testing-library、jest、vitest 等）的测试节点必然 compile fail
- 即使 retry 5 次也无法修复，因为问题不在代码质量，而在执行环境

**已知缺陷（待修复）**
- `verifyNode` 函数签名只接收 `specFragment`，没有 `nodeRole`，无法在 verify 阶段区分节点类型
- `post-node-handler.ts` 传给 `nodeVerifier` 的信息不够，只有文件路径和 specFragment
- `verify.ts` 缺少 tester 专用的测试运行路径

**解决方案**（待实施）

为 `tester` 节点建立独立执行环境：

```
output/
├── App.smoke.test.tsx
└── __verify_env/
    ├── package.json       ← { "type": "module" }
    └── node_modules -> ../../apps/web/node_modules  ← 软链
```

在 `__verify_env` 内用 vitest 实际运行测试（shipyard web 已安装 vitest），而不是只做 tsc 类型检查。

**改动范围**（已实施 ✅）：
- 根目录 `package.json` — 安装 vitest、@testing-library/react、jsdom 等依赖（workspace root）
- `packages/core/src/orchestrator/runtime-types.ts` — `NodeVerifier` 类型增加 `nodeRole?` 参数
- `packages/core/src/orchestrator/post-node-handler.ts` — 传 `node.nodeRole` 给 nodeVerifier
- `packages/core/src/verification/verify.ts` — 新增 `runTesterNodeVerification()`，verifyNode 按 nodeRole 分支；tester 节点创建临时环境 + symlink node_modules + vitest 实际运行
- `packages/core/src/ai/prompts.ts` — Planner prompt 说明 tester 节点可以使用 @testing-library/react 等测试框架

**风险**
- symlink 跨磁盘失败 → fallback 改为复制 node_modules（慢但可靠）
- vitest 版本兼容性
- jsdom 渲染超时 → timeout 设 60s

---

## 2. Review 层问题

### 2.1 review 文件读取被截断（已修复）

**现象**
reviewer 报 `code is incomplete/truncated`，实际是读取上限太小。

**根本原因**
`review.ts` 每个文件只读前 2000 字节，TS 实现文件经常超出。

**解决方案**（已实施）
读取上限 2000 → 6000 → **15000 字节**。

**案例**: `HeroSection.tsx` 约 10000 字节，6000 字节上限读不到文件末尾的 `export default`，reviewer 误判 "export missing / truncated"，verify 已通过但 review 失败。

---

### 2.2 Retry 时看不到上次写的代码（已修复）

**现象**
verify/review 失败后 retry，LLM 只知道错误信息，不知道自己上次写了什么，等于盲改。

**根本原因**
`cleanupNodeOutputsOnRetry` 在 retry 前删除所有输出文件，导致 `readPreviousFileContent` 读不到。

**解决方案**（已实施）
- 新增 `lastErrorKind: "fatal" | "verify" | "review"`
- 只有 `fatal` 错误才删文件，`verify`/`review` 失败保留文件
- retry prompt 里展示：`⚠️ PREVIOUS ATTEMPT FAILED (reason: verify/review) — 上次代码 + 具体错误`

---

## 3. 前端状态管理

### 3.1 删除 session 后 activeSession 不清空（已修复）

**现象**
删除当前活跃的 session 后，前端仍持有该 sessionId，后续 resume/retry 报 400。

**解决方案**（已实施）
`ProjectPanel` 删除 session 时，若被删的是 activeSession，立即调 `setActiveSession(null)`。

---

### 3.2 applyRealtimeEvent 用空 projectId 创建 session（已修复）

**现象**
SSE 事件触发 `applyRealtimeEvent` 时，session 不存在则用 `projectId: ""` 创建，导致 Retry 按钮找不到 projectId，报 `projectId and sessionId are required`。

**解决方案**（已实施）
`applyRealtimeEvent` 优先从 `event.projectId` 取值，其次从已有 session 取，保证 projectId 不为空。

---

## 4. Chat / 意图路由

### 4.1 Policy 正则过于宽泛（已修复）

**现象**
用户问"这个错误是什么意思"、"优化一下"等，都被 `NEW_RUN_RE` 命中，返回固定回复"收到，我先判断..."，完全不回答用户问题。

**根本原因**
`policy.ts` 的 `NEW_RUN_RE` 包含"优化/增加/做一个"等几十个词，命中率接近 100%，绕过了 LLM，返回固定字符串。

**决策**
删掉 `new_run` 的 policy 短路分支，所有非明确操作意图（status/resume/retry）一律走 LLM，让 LLM 真正理解并回答用户问题。

---

### 4.2 Resume intent 在无任务时触发 400（已修复）

**现象**
用户发"继续执行"，没有执行中的任务，但 policy `RESUME_RE` 直接返回 resume intent，前端发 `/api/resume` → 400。

**解决方案**（已实施）
- `policy.ts`: `resume` 分支加前提条件：必须有 `failed/running` 节点且 `currentSpec` 非空
- `runController.ts`: `activeSession` 不存在时收到 resume intent 直接展示 reply，不发请求

---

## 5. 会话管理

### 5.1 maxRetries 改动对已有 session 无效

**现象**
改了 `config.ts` 里的 `maxRetries: 5`，但旧 session 的节点还是显示 `maxRetries=2`。

**根本原因**
`maxRetries` 在 Planner 阶段写入 graph.json，之后直接从 graph.json 读取，不再引用 config。

**处理方法**
已有 session 需要手动修 graph.json，或用脚本批量更新：
```python
# 把所有非 checkpoint 节点的 maxRetries 改为 5
for pair in g['nodes']:
    node = pair[1]
    if node.get('type') != 'checkpoint':
        node['maxRetries'] = 5
```

---

## 6. 可观测性

### 6.1 执行日志（已实施）

每次 session 执行时，在 session 目录写入 `execution.log.jsonl`（JSONL 格式，实时追加）。

**路径**: `.shipyard/projects/{proj-id}/sessions/{sess-id}/execution.log.jsonl`

**包含事件**:
| 事件 | 内容 |
|------|------|
| `plan_complete` | 所有节点的 task/acceptanceCriteria/依赖关系 |
| `node_start` | 节点开始，含 retryCount |
| `node_prompt` | 发给 Implementer 的完整 prompt |
| `verify_result` | 编译/测试结果 + 完整错误 |
| `review_input` | 发给 Reviewer 的 criteria + 代码片段 |
| `review_result` | blocking 原因 + summary |
| `node_retry` | retry 次数 + 原因类型 |
| `node_done/failed` | 最终结果 + 耗时 |
| `session_done` | 整体统计 |

**分析方法**: 跑完一次后直接读日志，postmortem 定位问题。

---

## 7. 已知待解决问题

### P1 — Planner 节点粒度限制（下一步要做）

**问题**: 单文件多组件 → LLM 输出截断 → 代码不完整
**方案**: Planner prompt 加规则：
- 单文件只实现一个组件/类
- 预估超过 100 行则拆分
- UI 组件必须独立文件

**改动文件**: `packages/core/src/ai/prompts.ts`（`GRAPH_PLANNER_PROMPT`）

---

### P2 — Level 2: pre-executor（待评估）

**触发条件**: 节点数 > 20，retry 率明显上升
**方案**: 节点执行前轻量 LLM 调用，读取依赖文件真实内容，动态补全 task 和 acceptanceCriteria
**当前状态**: Level 1 优先，Level 2 按需引入

---

### P3 — 多节点同时 retry 竞争 graph.json

**问题**: 多个节点快速 retry 时，两个请求都读写同一个 graph.json，后一个覆盖前一个的 `ready` 状态
**影响**: 某个节点的 retry 状态丢失
**方案**: 写入 graph.json 时加文件锁，或改为队列式写入
**当前状态**: 低频场景，暂未处理

---

### P4 — sseManager.reset() 在 retry 时误调用

**问题**: 单节点 retry 触发 `runResumeSession` 时，`sseManager.reset()` 清空了所有 SSE 历史
**影响**: 前端重连后看不到之前的进度
**方案**: retry 触发的 resume 不应 reset SSE，只有全新 run 才 reset
**当前状态**: 待修复

---

*最后更新: 2026-05-01*
