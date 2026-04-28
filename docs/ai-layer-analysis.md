# Shipyard AI 层分析与改进路线

> 记录于 2026-04-28

---

## 一、AI 层运作逻辑

整体是一个 **"规划 → 并行执行 → 验证 → 重试"** 的流水线，入口为 `packages/core/src/shipyard.ts` 的 `run()` 函数。

### 数据流

```
用户 spec
  → Planner LLM    → ExecutionGraph（DAG of GraphNodes）
  → Scheduler      → 按依赖顺序并行派发
  → per node:
      → Implementer LLM（agent loop + tool_use）
      → verify.ts（compile → behavior）
      → status: done | failed | retrying
  → graph.json     → 被 UI / API 消费
```

### 节点状态机

```
pending → ready → running → verifying → done (终态)
                           ↘ failed → ready (重试，最多 maxRetries 次)
                                    ↘ failed (超限，终态)
pending → blocked（依赖节点失败，自动级联）
done 后 → 解除下游 blocked 节点
```

### 三个 LLM 角色

| 角色 | Prompt 文件 | 用途 | 有 tools？ |
|------|------------|------|-----------|
| **Planner** | `GRAPH_PLANNER_PROMPT` | 分解 spec → DAG 计划 | ❌ 纯 JSON 输出 |
| **Implementer** | `IMPLEMENTER_PROMPT` | 写代码（agent loop） | ✅ write/read/run |
| **Reviewer** | `REVIEWER_PROMPT` | 代码 review | ❌ 纯 JSON 输出 |
| **Spec Extractor** | `SPEC_EXTRACTOR_PROMPT`（verify.ts 内） | 从 spec + 实现代码提取行为测试用例 | ❌ 纯 JSON 输出 |

### 验证两层

1. **确定性验证**：`npx tsc --noEmit` 编译（必须通过，否则直接失败）
2. **行为验证**：LLM 从 spec 提取测试用例 → 生成临时 `.ts` 文件 → `ts-node` 执行
   - `hard` 失败 → 节点失败，走重试
   - `soft` 失败 → 记录警告，节点仍通过

### 重试机制

- 失败原因（编译错误 / 行为验证错误 / code review blocking）写入 `node.lastError`
- 下次 `executeNode()` 时注入 prompt：`⚠️ PREVIOUS ATTEMPT FAILED + 错误内容 + 上次写的代码`
- 最多 `maxRetries`（默认 2）次

---

## 二、当前工具能力边界

`packages/core/src/llm.ts` 中 `TOOLS` 为硬编码静态常量，只有 3 个工具：

| 工具 | 限制 |
|------|------|
| `write_file` | 只能写 `workDir` 内（`hooks.ts` 路径安全校验） |
| `read_file` | 内容截断到 3000 字符 |
| `run_command` | 白名单：只允许 `npx tsc`、`tsc`、`node ` 开头 |

**完全没有：** MCP 工具接入、本地 skill 调用、网络请求、包管理器、git 操作、代码搜索。

---

## 三、与 Claude Code 等工具相比的核心差距

### 3.1 工具/环境能力

| 能力 | Claude Code | Shipyard 现状 | 代码位置 |
|------|------------|--------------|---------|
| 任意 shell 命令 | ✅ | ❌ 只允许 tsc/node | `llm.ts:135` 白名单 |
| 包管理（npm/pip） | ✅ | ❌ 被白名单拦截 | 同上 |
| git 操作 | ✅ | ❌ | 同上 |
| 搜索代码（grep） | ✅ | ❌ | 工具集无此工具 |
| MCP 工具 | ✅ | ❌ 无任何 MCP 接入 | — |
| 网络请求 | ✅ | ❌ | 工具集无此工具 |

### 3.2 仓库感知能力

- **只在规划阶段读一次**（`repo.ts` `extractRepoContext()`），执行过程中不再感知仓库变化
- 最多 20 个文件，只读 `src/` 下 `.ts/.tsx`，每文件截断 1500~2000 字符
- 执行节点时，只有直接依赖节点的输出文件内容被注入（截断 2000 字符），无法主动探索上下文

### 3.3 交互与人工介入

- `GraphNode.type = "checkpoint"` 和 `getCheckpointNodes()` 已定义，但**调度器主循环里没有任何暂停逻辑**
- `CLARIFIER_PROMPT` 已定义，但 `run()` 主流程里**完全没有调用**
- Resume 机制只能重置 `running/verifying → ready`，无法从任意节点重开

### 3.4 验证能力

- **不执行 `*.test.ts` 文件**（已知 bug，engine skill 有标注）
- **lint 验证类型已定义但从未运行**（`VerificationRecord.type = "lint"` 存在但无实现）
- 行为验证的函数名匹配依赖字符串包含，export 方式稍复杂就失效
- 只验证单文件，多文件集成行为无法验证

### 3.5 多语言支持

Planner prompt 写了支持 `.py`/`.go`，但验证层（`tsc`/`ts-node`）完全绑死 TypeScript。

---

## 四、改进路线与参考开源项目

### 优先级排序（按投入产出比）

#### ⭐⭐⭐ P0 — 增加代码搜索工具

**问题**：Implementer 看不清仓库，只能靠被动注入的片段盲写  
**参考**：[Aider](https://github.com/paul-gauthier/aider) — `grep_search`、`find_file` 作为一等公民工具  
**改动**：`llm.ts` 的 `TOOLS` 数组 + `executeTool()` 函数，约 50 行

```typescript
// 新增工具示例
{ name: "search_files" }  // ripgrep 封装
{ name: "list_dir" }      // 主动探索目录结构
```

#### ⭐⭐⭐ P0 — 用容器沙箱替代命令白名单

**问题**：无法安装依赖、运行测试、执行 Python/Go，无法生成"真正能运行"的完整项目  
**参考**：[OpenHands](https://github.com/All-Hands-AI/OpenHands) — Docker container 隔离，工具集放开 `bash`  
**改动**：`llm.ts` 的 `executeTool` 改为调 Docker exec API，`run_command` 白名单移除

#### ⭐⭐ P1 — 实现 Checkpoint 暂停逻辑

**问题**：`checkpoint` 节点类型存在但调度器完全没实现  
**参考**：[LangGraph](https://github.com/langchain-ai/langgraph) — `interrupt()` 机制，与 Shipyard 图执行模型几乎同构  
**改动**：`shipyard.ts` 主循环，在 `getReadyNodes()` 之前检查 checkpoint 节点，暂停并等待外部信号

#### ⭐⭐ P1 — 执行项目已有的 `*.test.ts`

**问题**：生成的测试文件从不被执行  
**参考**：[SWE-agent](https://github.com/SWE-agent/SWE-agent) — 把"运行测试"作为核心工具，agent 主动调用  
**改动**：`verify.ts` 的 `verifyNode()` 增加第三步：扫描 `outputFiles` 相关的 `*.test.ts` 并执行

#### ⭐⭐ P1 — tree-sitter 替代字符截断

**问题**：`repo.ts` 按字符截断文件，LLM 看到的是残缺代码  
**参考**：[Sweep](https://github.com/sweepai/sweep) / [Aider repo-map](https://aider.chat/docs/repomap.html)  
**改动**：`repo.ts` 改用 `tree-sitter` 或 `ctags` 解析符号（函数/类/接口签名），按符号粒度注入

```
现状：读文件 → 截断 1500 字符 → 塞进 Planner prompt
改进：tree-sitter → 提取所有 export 签名 → 按需检索注入（RAG 模式）
```

#### ⭐ P2 — Temporal 迁移

**参考**：[Temporal](https://temporal.io)（项目已有 `TEMPORAL_MIGRATION_PLAN.md`）  
Temporal 的 `Signal` 机制天然对应 checkpoint 的"暂停等待人工输入"，`Activity` 对应单节点执行  
这是架构级改动，建议在 P0/P1 完成后再做

#### ⭐ P2 — 多 Agent 对话协作

**参考**：[AutoGen](https://github.com/microsoft/autogen) / [CrewAI](https://github.com/crewAIInc/crewAI)  
Reviewer 发现问题后直接和 Implementer 对话，而不是只返回 JSON 触发重试  
Shipyard 的三角色结构（Planner/Implementer/Reviewer）天然适合 CrewAI 的 Crew + Task 模型

---

## 五、最快见效的单点改进

在 `llm.ts` 里新增 `search_files` 工具（ripgrep 封装），让 Implementer 能主动搜索现有代码。

这能解决"生成的代码与已有代码不一致、import 路径错误、重复实现已有函数"这个最高频的问题，改动量小（约 50 行），但能显著提升多文件项目的代码质量。

---

## 六、用一句话理解核心问题

Shipyard 的架构设计是对的（DAG + 并行 + 透明），但 **LLM 现在像个被关在小房间里的程序员——只有一张桌子、三支笔、看不到窗外**。

问题本质只有三个：

| 卡点 | 现象 | 根因 |
|------|------|------|
| **看不清仓库** | import 路径错、重复实现已有功能 | `repo.ts` 只在规划时快照一次，字符截断，执行中盲写 |
| **做不了事** | 不能装依赖、不能跑测试、生成的是"文件"不是"能跑的项目" | `run_command` 白名单只允许 tsc/node，工具集仅 3 个 |
| **人没法介入** | LLM 猜错需求只能靠重试修，效率低 | checkpoint/clarifier 已定义但调度器里从未调用 |

---

## 七、整套开源参考项目速览

> 以下项目都是完整体系开源，可以直接读源码。

### opencode（SST 出品）⭐ 151k
**GitHub**：`sst/opencode`  
**技术栈**：Go 后端 + TypeScript TUI  
**解决的卡点**：卡点 3（人工介入）

- Session 暂停 + 恢复机制，对应 Shipyard 缺失的 checkpoint 流程
- **MCP 原生支持**：工具层直接接 MCP Server，任何 MCP 工具即插即用
- Permission 模型：每个危险操作都有 allow/deny/always-allow 确认机制
- 重点看：`packages/opencode/src/tool/`（工具注册机制）、`packages/opencode/src/session/`

---

### Cline（前身 Claude Dev）⭐ 40k
**GitHub**：`cline/cline`  
**技术栈**：TypeScript，VSCode 插件（和 Shipyard 技术栈最接近）  
**解决的卡点**：卡点 2（工具）+ 卡点 3（人工介入）

目前开源项目里**工具集最完整**的，直接对标 Claude Code：
- `search_files`（ripgrep 搜代码）
- `list_files`（主动探索目录）
- `execute_command`（任意命令，无白名单）
- `browser_action`（控制浏览器）
- MCP 工具接入

每次文件变更、命令执行前都有 diff 预览 + approve/reject，human-in-the-loop 最完善。  
**如果只看一个项目，看这个。**

---

### OpenHands（前身 OpenDevin）⭐ 48k
**GitHub**：`All-Hands-AI/OpenHands`  
**技术栈**：Python 后端 + Web UI  
**解决的卡点**：卡点 2（工具的安全执行）

- **Docker 沙箱是核心**：所有命令在容器里跑，这是唯一正确解决"任意命令执行"的方式
- Runtime 可插拔：Docker / Kubernetes / E2B 都支持
- EventStream 架构：所有 Agent 动作都是 Event，可回放、可可视化，和 Shipyard 的 Evidence 思路最接近
- 重点看：`openhands/runtime/`（沙箱执行层）

---

### Aider ⭐ 25k
**GitHub**：`paul-gauthier/aider`  
**技术栈**：Python，CLI  
**解决的卡点**：卡点 1（仓库感知）

- **repo-map 是核心创新**：用 `tree-sitter` 解析整个仓库符号树，生成精简地图注入 LLM
- LLM 不需要读每个文件，但它知道整个项目有哪些东西、在哪里——按语义提取，而非字符截断
- Git 深度集成：每次修改自动 commit，可一键 undo
- Architect + Editor 双 LLM 模式（≈ Shipyard 的 Planner/Implementer，但更成熟）
- 重点看：`aider/repomap.py`，直接对应 `repo.ts` 的改进方向

---

### Goose（Block/Square 出品）⭐ 11k
**GitHub**：`block/goose`  
**技术栈**：Rust  
**解决的卡点**：工具动态注册

- Extension/Toolkit 插件系统，工具以插件形式接入，支持 MCP
- 设计极为模块化，适合作为"可嵌入的 AI 执行引擎"参考
- 重点看：工具注册和 Toolkit 启用/禁用机制

---

### 各项目与 Shipyard 模块的对应关系

| Shipyard 模块 | 最佳参考项目 | 核心借鉴点 |
|--------------|------------|----------|
| `llm.ts` 工具集 | **Cline** | 完整工具集（search、browser、command 无白名单） |
| `llm.ts` run_command 安全执行 | **OpenHands** | Docker 沙箱替代字符串白名单 |
| `repo.ts` 仓库感知 | **Aider** | tree-sitter repo-map，按符号粒度而非字符截断 |
| `shipyard.ts` checkpoint 暂停 | **opencode** / **Cline** | Session 暂停 + human approve 流程 |
| 工具动态注册 / MCP | **Goose** / **opencode** | Toolkit 插件化 + MCP 原生支持 |
| Evidence / 可回放 | **OpenHands** | EventStream，所有动作都是可回放的 Event |
