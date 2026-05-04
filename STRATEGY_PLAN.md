# Shipyard — Task Strategy 架构计划

> 状态：草稿，待讨论确认
> 最后更新：2026-04-27

---

## 背景与问题

当前 Shipyard 只有一种执行模式：把所有任务都拆成 TypeScript 文件。
用户说"做一个网站"，生成的是 `.ts` 模块；说"做一个 PPT"，也是 `.ts` 文件。

根本原因：引擎没有"任务类型"的概念，Planner/Implementer/Verifier 都是写死的。

---

## 核心抽象：TaskStrategy

每种任务类型对应一个 Strategy，Strategy 定义了完整的执行链路：

```typescript
interface TaskStrategy {
  id:       string                    // 唯一标识
  name:     string                    // 人类可读名称
  detect:   (spec: string) => number  // 置信度 0-1，用于自动检测
  plan:     () => PlannerConfig       // Planner prompt + 规则
  tools:    () => Tool[]              // Implementer 可用工具集
  verify:   () => VerifierConfig      // 验证方式
  preview:  () => PreviewerConfig     // 结果展示方式
}
```

---

## Strategy 列表（当前 + 规划）

### 已有（需提取）

| Strategy | 触发关键词 | 产物 | 验证 | 预览 |
|---|---|---|---|---|
| `typescript-lib` | 默认 / function / module / class | `.ts` 文件 | tsc + 行为测试 | 文件预览 + ts-node 输出 |

### Phase 2（近期）

| Strategy | 触发关键词 | 产物 | 验证 | 预览 |
|---|---|---|---|---|
| `static-web` | 网站 / webpage / HTML / landing page | `index.html` + CSS + JS（自包含） | HTML 语法 + 链接检查 | iframe 内嵌 |
| `react-app` | React / SPA / 前端应用 / dashboard | Vite+React 项目结构 | tsc + npm build | dev server + iframe |
| `node-server` | API / server / Express / backend | `server.ts` + 路由 | tsc + HTTP 健康检查 | curl 输出 / API 文档 |

### Phase 3（中期）

| Strategy | 触发关键词 | 产物 | 验证 | 预览 |
|---|---|---|---|---|
| `presentation` | PPT / 幻灯片 / slides / 演示 | reveal.js HTML 或 PPTX | 页数检查 + 内容完整性 | 幻灯片播放器 |
| `mobile-app` | 移动端 / React Native / Flutter / iOS / Android | RN 或 Flutter 项目 | 编译检查 | Expo Go 二维码 |
| `full-stack` | 全栈 / full-stack / 前后端 | 前端 + 后端 + DB schema | 集成测试 | 前端 iframe + 后端进程 |

### Phase 4（远期）

| Strategy | 触发关键词 | 产物 | 验证 | 预览 |
|---|---|---|---|---|
| `graduation-thesis` | 毕业设计 / 论文 / 报告 | Markdown + 图表 + 参考文献 | 格式检查 + 字数统计 | PDF 预览 |
| `data-analysis` | 数据分析 / 可视化 / Jupyter | Python notebook + 图表 | 运行检查 | 图表预览 |
| `cli-tool` | CLI / 命令行工具 | 可执行脚本 | 功能测试 | 终端输出 |

---

## 架构改动

### 引擎层（src/）

```
src/
├── strategies/
│   ├── index.ts          ← Strategy 注册表 + detectStrategy()
│   ├── base.ts           ← TaskStrategy 接口定义
│   ├── typescript-lib.ts ← 现有流程提取
│   ├── static-web.ts     ← 静态网站
│   └── react-app.ts      ← React 应用
│
├── tools/                ← Implementer 工具集（按 Strategy 注入）
│   ├── file.ts           ← write_file（现有）
│   ├── shell.ts          ← run_command（现有，需扩展）
│   └── npm.ts            ← npm install / build（新增）
│
├── shipyard.ts           ← run() 前 detectStrategy()
├── prompts.ts            ← 每个 Strategy 有独立 prompt
└── verify.ts             ← Strategy 决定验证方式
```

### 执行流程变化

```
现在：
  run(spec) → buildGraph → executeNodes → verify

未来：
  run(spec)
    → detectStrategy(spec)          // 自动检测，置信度最高的 Strategy
    → strategy.plan(spec)           // Strategy 专属 Planner prompt
    → strategy.executeNodes(nodes)  // Strategy 专属工具集
    → strategy.verify(output)       // Strategy 专属验证
    → strategy.preview(output)      // Strategy 专属预览
```

### 前端层（apps/web/）

新增 Preview Panel，根据 Strategy 渲染不同预览组件：

```
features/
└── preview/
    ├── PreviewPanel.tsx      ← 根据 strategy 类型选择预览组件
    ├── IframePreview.tsx     ← static-web / react-app
    ├── TerminalPreview.tsx   ← node-server / cli-tool
    ├── SlidePreview.tsx      ← presentation
    └── CodePreview.tsx       ← typescript-lib（现有文件预览）
```

---

## 待讨论的问题

### Q1：Strategy 检测方式

**选项 A — 自动检测（LLM 判断）**
- 用户无感知，体验流畅
- 可能猜错，例如"做一个 function 来处理网页数据"被误判为 static-web

**选项 B — 用户手动选择**
- 准确，但多一步操作
- 新用户不知道选什么

**选项 C — 自动 + 可覆盖**
- 自动检测后显示"检测为 React 应用，是否正确？"
- 用户可以在聊天框里说"用静态网站方式做"来覆盖

> 倾向：**选项 C**，自动检测兜底，用户可以在聊天里纠正

---

### Q2：Preview 放在哪里

**选项 A — Shipyard 内嵌 iframe**
- 需要管理 dev server 端口、进程生命周期
- 体验最好，所见即所得
- 复杂度高

**选项 B — 外部打开**
- 简单，点击在新标签页打开
- 割裂感，离开 Shipyard 界面

**选项 C — 分阶段**
- Phase 2 先做外部打开（简单）
- Phase 3 再做内嵌预览（完整）

> 倾向：**选项 C**，先快速验证，后完善体验

---

### Q3：工具集扩展

Implementer 现在只有 `write_file` 和 `run_command`（只允许 tsc/node）。

不同 Strategy 需要不同工具：

```
static-web   → write_file（HTML/CSS/JS）
react-app    → write_file + npm_install + npm_build
node-server  → write_file + npm_install + start_server
mobile-app   → write_file + flutter_build / expo_start
```

**问题**：`run_command` 现在有白名单限制（只允许 tsc/node）。
扩展时需要按 Strategy 配置白名单，而不是全局写死。

---

### Q4：多文件类型支持

现在 Planner 生成的 outputFile 都是 `.ts`。
需要让 Planner 知道当前 Strategy 允许的文件类型：

```
typescript-lib → .ts
static-web     → .html, .css, .js
react-app      → .tsx, .ts, .css, .json, .html
presentation   → .html, .json（reveal.js 配置）
```

---

## 实施顺序建议

```
Step 1 — 接口定义（不改现有行为）✅ (2026-05-04)
  定义 TaskStrategy 接口                 → packages/core/src/strategies/base.ts
  把现有流程提取成 typescript-lib Strategy → packages/core/src/strategies/typescript-lib.ts
  加 detectStrategy()（暂时总是返回 typescript-lib）→ packages/core/src/strategies/index.ts
  编译通过，行为不变                      → tsc + 26 tests + server build + web build ✅

Step 2 — static-web Strategy ✅ (2026-05-04)
  ✅ Planner prompt → packages/core/src/strategies/static-web.ts
  ✅ Implementer tools → SW_TOOLS
  ✅ Strategy 参数已接入完整 orchestrator 链路
  ✅ Preview：现有 PreviewPanel 已支持 iframe + "Open raw" 新标签页打开
  ✅ Verifier：reviewer prompt 内置 HTML/CSS/JS 语法检查

Step 3 — detectStrategy 真正工作 ✅ (2026-05-04)
  ✅ detectStrategy() 已接入 server run.ts：根据 spec 关键词自动选择
  ✅ static-web 关键词检测：网站/webpage/landing page → 0.95 置信度
  ✅ strategyId 字段已加入 RunRequest（前端可显式指定）/ RunResponse / GraphSummary
  ✅ SSE log 事件广播 "Using strategy: <name>"
  ✅ 用户可通过 strategyId 参数覆盖自动检测（getStrategy 回退）
  LLM 判断 spec 类型
  聊天框支持"用 React 做"这样的覆盖指令
  前端展示当前使用的 Strategy

Step 4 — react-app Strategy ✅ (2026-05-04)
  ✅ Vite+React+TypeScript 策略 → packages/core/src/strategies/react-app.ts
  ✅ Planner/Implementer/Reviewer 三套独立 prompt（React 19 约定：React.JSX.Element）
  ✅ 工具集含 npm install/build（allowedCommands 含 npx vite）
  ✅ Verifier: compile=true (tsc --jsx react), behavior=false, lint=true
  ✅ Preview: iframe type
  ✅ 关键词检测：react/spa/dashboard/前端应用 → 0.9, 组件/jsx/vite → 0.65
  ✅ 已注册到 registry，detectStrategy 自动识别
  ✅ 26 tests / typecheck / server / web 全绿

Step 5 — 更多 Strategy（按需）▶
  ✅ node-server → packages/core/src/strategies/node-server.ts (2026-05-04)
     Express.js + TypeScript, tsc compile check, terminal preview
     关键词检测：api/server/express/backend/后端 → 0.9
  ⬜ presentation / mobile-app / full-stack / graduation-thesis / data-analysis / cli-tool
```

---

## 开放问题（需要你决策）

1. **Q1 Strategy 检测**：自动 / 手动 / 自动+可覆盖？
2. **Q2 Preview 位置**：内嵌 / 外部 / 分阶段？
3. **优先级**：先做 static-web 还是 react-app？
4. **工具白名单**：按 Strategy 配置，还是全局放开？
5. **移动端**：React Native 还是 Flutter 优先？

---

*本文档用于讨论，确认后转为实施计划*
