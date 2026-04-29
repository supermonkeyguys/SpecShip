# Shipyard Web UI Library Migration Plan (shadcn/ui + Radix)

> 目标：在不打断当前业务重构主线的前提下，把 `apps/web` 中“手搓的通用交互壳组件”逐步替换为 **shadcn/ui + Radix UI** 风格的基础组件。
>
> 原则：
> - 保留业务特有组件（Canvas / Graph / Session orchestration / Chat orchestration）
> - 替换通用交互壳层（Tabs / Dialog / Badge / Alert / Button / Input / ScrollArea）
> - 优先做低风险、高复用、高 a11y 收益的替换

---

## 1. 推荐技术栈

### 基础方案
- `@radix-ui/react-tabs`
- `@radix-ui/react-dialog`
- `@radix-ui/react-scroll-area`
- `@radix-ui/react-slot`
- `class-variance-authority`
- `clsx`
- `tailwind-merge`
- `lucide-react`
- `sonner`（第二批，可选）

### 为什么选这套
- 与现有 `React + Vite + Tailwind` 最兼容
- 视觉不强绑定，适合 IDE / 工作台产品
- 可访问性收益明显
- 不会强迫重写全站样式体系
- 支持逐步迁移而非一次性替换

---

## 2. 迁移边界

## 2.1 本轮建议替换

### 通用基础组件
- Button
- Input
- Tabs
- Dialog
- Badge
- Alert
- ScrollArea
- Separator

### 对应现有手搓位置
- `apps/web/src/features/chat/Chat.tsx`
- `apps/web/src/features/canvas/Canvas.tsx`
- `apps/web/src/components/StatusBadge.tsx`
- `apps/web/src/features/session/ResumeBar.tsx`
- `apps/web/src/features/files/FilePreview.tsx`

---

## 2.2 本轮暂不替换

### 业务强绑定组件
- `Canvas` 的 React Flow 主体
- `ProjectPanel` 的业务结构与数据层
- `Chat` 的 orchestration 逻辑
- `useSession` / `useSSE` / store
- 文件预览的数据获取逻辑

### 原因
这些组件当前的问题主要是状态边界和业务流程，不是 UI primitive 缺失。

---

## 3. 迁移策略

采用“两层迁移”：

### Layer A：先引入 primitives
先在 `apps/web/src/components/ui/` 下建立最小基础组件层。

### Layer B：再替换具体页面组件
优先替换：
1. `StatusBadge`
2. `ResumeBar`
3. `Chat tabs`
4. `NodeDetail -> Dialog`
5. `FilePreview` 容器壳

---

## 4. 第一批迁移清单（建议立即执行）

## M1. 基础依赖接入

### 新增依赖
建议加到 `apps/web/package.json`：

```json
{
  "dependencies": {
    "@radix-ui/react-dialog": "^1.x",
    "@radix-ui/react-scroll-area": "^1.x",
    "@radix-ui/react-slot": "^1.x",
    "@radix-ui/react-tabs": "^1.x",
    "class-variance-authority": "^0.x",
    "clsx": "^2.x",
    "lucide-react": "^0.x",
    "tailwind-merge": "^2.x"
  }
}
```

> `sonner` 可放第二批。

### 验收标准
- 依赖安装成功
- Vite/TS 构建正常

---

## M2. 新建 UI primitives

### 新增目录
```text
apps/web/src/components/ui/
```

### 第一批新增文件
- `button.tsx`
- `input.tsx`
- `tabs.tsx`
- `dialog.tsx`
- `badge.tsx`
- `alert.tsx`
- `scroll-area.tsx`
- `separator.tsx`
- `utils.ts`（如需要）

### 目标
- 不追求 shadcn 完全脚手架一致
- 先建立“本仓库自己的 shadcn-style primitives”
- 组件 API 保持轻量、可继续扩展

### 验收标准
- 以上 primitives 能被现有页面组件直接消费
- 样式与现有 Tailwind 基调不冲突

---

## M3. 替换 `StatusBadge`

### 当前文件
- `apps/web/src/components/StatusBadge.tsx`

### 目标替换
- 用 `Badge` primitive 重写
- 状态映射保留，但改为统一 variant 体系

### 推荐实现方向
状态：
- idle
- running
- done
- failed

Badge variant：
- secondary
- warning
- success
- destructive

### 验收标准
- 顶栏状态视觉更统一
- 组件不再直接输出手搓 class 字符串块

---

## M4. 替换 `ResumeBar`

### 当前文件
- `apps/web/src/features/session/ResumeBar.tsx`

### 目标替换
- 用 `Alert + Button + Badge/StatusPill` 组合
- 保持现有信息量和 CTA

### 收益
- 视觉和交互更一致
- warning 状态表达更标准
- 后续更容易扩展更多 banner 类型

### 验收标准
- Resume 条不再是一次性手搓结构
- 保持现有 resume/dismiss 行为不变

---

## M5. 替换 `Chat` 顶部 Tabs

### 当前文件
- `apps/web/src/features/chat/Chat.tsx`

### 目标替换
- 用 `Tabs` primitive 替换手搓 `chat/log` tab

### 注意
- 本轮只替换 tab 壳层
- 不改 `ChatPanel` / `LogPanel` 业务逻辑

### 验收标准
- tab 交互保持一致
- 获得更好的语义与键盘支持

---

## M6. 替换 `NodeDetail` 为 `Dialog`

### 当前文件
- `apps/web/src/features/canvas/Canvas.tsx`

### 目标替换
- 把 `NodeDetail` 从绝对定位浮层改为 `Dialog`
- `selected` 控制 dialog open/close

### 注意
- 不改 `Canvas` 的 React Flow 主体
- 只改节点详情展示壳层

### 收益
- 焦点管理更合理
- Escape 关闭天然支持
- a11y 明显提升

### 验收标准
- 点击节点仍能打开详情
- 可关闭
- 不影响图本体渲染

---

## M7. `FilePreview` 容器壳层升级（可选第一批末尾 / 第二批开头）

### 当前文件
- `apps/web/src/features/files/FilePreview.tsx`

### 目标替换
- 用 `ScrollArea + Separator + Button` 改造容器壳层
- 不动文件获取逻辑

### 验收标准
- 文件预览滚动与头部交互更规范
- loading / empty 状态更容易扩展

---

## 5. 第二批迁移清单（建议在状态重构后进行）

## M8. 统一状态展示组件
新增：
- `EmptyState`
- `InlineError`
- `LoadingState`
- `StatusPill`

适用位置：
- Chat loading / error
- FilePreview loading / error
- Sidebar empty / error
- Resume / running banner

---

## M9. `ProjectPanel` 壳层升级
建议未来引入：
- `ScrollArea`
- `Separator`
- `Collapsible` / `Accordion`

> 注意：必须等 `ProjectPanel` 的轮询和数据逻辑先抽离，否则只换壳收益有限。

---

## M10. Toast / 全局反馈
建议引入：
- `sonner`

适用于：
- run 启动成功
- resume 失败
- retry 失败
- SSE 连接错误
- 文件加载失败

---

## 6. 风险分级

## 低风险（可立即做）
- M1 基础依赖
- M2 UI primitives
- M3 StatusBadge
- M4 ResumeBar
- M5 Chat Tabs

## 中风险
- M6 NodeDetail -> Dialog
- M7 FilePreview 容器壳层升级

## 暂缓
- ProjectPanel 全量组件化
- Chat 消息体系全量组件化
- 与 execution/session 状态边界强耦合的重构

---

## 7. 建议并发分工（适合 subagent）

## Worker A — UI primitives owner
**负责范围**
- `apps/web/src/components/ui/*`
- `apps/web/package.json`

**任务**
- 接入 Radix 依赖
- 创建基础 primitives
- 提供统一 class/variant 方案

**不要修改**
- Chat 业务逻辑
- Canvas 业务逻辑
- Session 业务逻辑

---

## Worker B — Status/Resume 迁移 owner
**负责范围**
- `apps/web/src/components/StatusBadge.tsx`
- `apps/web/src/features/session/ResumeBar.tsx`

**任务**
- 基于 primitives 替换 StatusBadge / ResumeBar
- 确保 API 不变，便于无缝接入 `App.tsx`

**不要修改**
- Chat
- Canvas
- Sidebar

---

## Worker C — Chat tabs 迁移 owner
**负责范围**
- `apps/web/src/features/chat/Chat.tsx`

**任务**
- 仅替换顶部 tabs 壳层
- 保持现有 `ChatPanel` / `LogPanel` / clarification 行为不变

**不要修改**
- run orchestration
- API 调用流程
- message 数据结构

---

## Worker D — NodeDetail dialog 迁移 owner
**负责范围**
- `apps/web/src/features/canvas/Canvas.tsx`

**任务**
- 把 `NodeDetail` 壳层替换成 `Dialog`
- 保持节点点击交互不变

**不要修改**
- 节点布局算法
- graph store
- React Flow 主体数据流

---

## 8. 推荐执行顺序

### 第一步
- M1 基础依赖接入
- M2 建 primitives

### 第二步（可并行）
- Worker B：M3 + M4
- Worker C：M5
- Worker D：M6

### 第三步
- 整体联调
- 修样式一致性
- 补 TS / build 校验

---

## 9. 验收 checklist

- [ ] 已引入 Radix / shadcn-style primitives
- [ ] `StatusBadge` 已迁移到 `Badge`
- [ ] `ResumeBar` 已迁移到 `Alert + Button`
- [ ] `Chat` 顶部 tabs 已迁移到 `Tabs`
- [ ] `NodeDetail` 已迁移到 `Dialog`
- [ ] TS 检查通过
- [ ] web build 通过
- [ ] 原有核心业务逻辑未回归

---

## 10. 本轮迁移的成功标准

如果本轮完成，Shipyard 前端会获得：

1. 更统一的基础交互层
2. 更好的 a11y 基础能力
3. 更少手搓通用 UI 代码
4. 更适合后续继续做状态边界重构

但要明确：

> **组件库迁移不是前端架构重构的替代品。**
>
> 它解决的是“通用交互壳层质量”，
> 不是“session-aware 状态模型”和“Chat orchestration 过重”问题。

因此推荐把本方案与 `FRONTEND_REFACTOR_PLAN.md` 并行推进：

- 组件库迁移：改善 UI primitive 层
- 状态重构：改善业务边界层

两者互不冲突，且能互相增益。

---

## 11. 交接进度记录（2026-04-28）

### 11.1 结论

本计划的**第一批迁移目标已基本完成**，可以视为已进入“完成并冻结”状态。

也就是说：

- 下一位 AI **不应再把这份计划当作当前主线任务重复执行**
- 后续重点应转回 `FRONTEND_REFACTOR_PLAN.md`

### 11.2 已完成项

以下已完成并已接入现有 `apps/web`：

#### M1. 基础依赖接入 ✅
已接入：
- `@radix-ui/react-dialog`
- `@radix-ui/react-scroll-area`
- `@radix-ui/react-separator`
- `@radix-ui/react-slot`
- `@radix-ui/react-tabs`
- `@radix-ui/react-collapsible`
- `class-variance-authority`
- `clsx`
- `tailwind-merge`
- `lucide-react`

#### M2. 新建 UI primitives ✅
已存在目录：
- `apps/web/src/components/ui/`

已存在文件：
- `alert.tsx`
- `badge.tsx`
- `button.tsx`
- `collapsible.tsx`
- `dialog.tsx`
- `input.tsx`
- `scroll-area.tsx`
- `separator.tsx`
- `tabs.tsx`
- `textarea.tsx`
- `utils.ts`

#### M3. `StatusBadge` 迁移 ✅
已完成：
- `apps/web/src/components/StatusBadge.tsx`
- 现已基于 `Badge`

#### M4. `ResumeBar` 迁移 ✅
已完成：
- `apps/web/src/features/session/ResumeBar.tsx`
- 现已基于 `Alert + Badge + Button`

#### M5. `Chat` 顶部 Tabs 迁移 ✅
已完成：
- `apps/web/src/features/chat/Chat.tsx`
- 顶部 chat/log 切换已使用 `Tabs`
- 底部 composer 也已用 `Input + Button`

#### M6. `NodeDetail` -> `Dialog` ✅
已完成：
- `apps/web/src/features/canvas/Canvas.tsx`
- `NodeDetail` 已迁移到 Radix `Dialog` 壳层（保留当前非模态使用方式）

#### M7. `FilePreview` 容器壳层升级 ✅
已完成：
- `apps/web/src/features/files/FilePreview.tsx`
- 已使用 `Button + ScrollArea + Separator`

#### 额外已完成但原计划未单列的项 ✅
- `apps/web/src/features/session/ProjectPanel.tsx`
  - 已使用 `Button + ScrollArea + Separator + Collapsible`
- `apps/web/src/features/chat/ClarificationCard.tsx`
  - 已使用 `Button + Input + Textarea + Separator`

### 11.3 已验证

以下已通过：
- `./node_modules/.bin/tsc -p tsconfig.json --noEmit`
- `pnpm --dir apps/web build`

### 11.4 当前建议

这份计划目前可视为：

- **第一批迁移已完成**
- **第二批可暂缓**
- **主线应切回前端架构重构，而不是继续做组件壳层替换**

### 11.5 下一位 AI 不要重复做的事

不要重复：

- 再次安装同一批 Radix/shadcn 依赖
- 再次创建同名 primitives
- 再次重写 `StatusBadge / ResumeBar / Chat Tabs / NodeDetail / FilePreview` 这些已经迁移过的组件

如果需要继续使用本计划，只建议做：

- 小规模视觉统一
- 补 `Toast / EmptyState / InlineError / LoadingState`
- 在前端主线稳定后再做第二批 polish


### 11.6 本次交接确认（当前会话补记）

本次会话未继续推进新的组件迁移实现，仅确认这份计划的交接状态仍然有效。

确认结论：

- 第一批 UI 迁移已完成，状态保持不变
- 这份计划继续处于“已完成并冻结”的定位
- 下一位 AI 不应把组件库替换当作当前主线任务重新展开
- 主线仍应回到 `FRONTEND_REFACTOR_PLAN.md` 中的 session / resume 架构收口
