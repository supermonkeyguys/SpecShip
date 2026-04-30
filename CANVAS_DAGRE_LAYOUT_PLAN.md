# Shipyard Canvas Dagre 自动布局方案（方案 B）

> 目标：将当前 `apps/web` 里基于简单网格的 Canvas 节点排布，升级为基于 `dagre` 的分层 DAG 自动布局，使画板更接近树形/流程图观感，同时保持现有 `dependsOn` 多父依赖语义不变。
>
> 文档用途：
> - 作为实现前的技术方案
> - 作为分阶段执行清单
> - 作为后续 AI / 工程师接手时的上下文与进度面板

---

## 0. 当前进度

**整体状态：基础实现完成，待人工体验验收**

- [x] 现状分析完成：确认当前 Canvas 使用固定网格布局（左到右、上到下）
- [x] 方案选型完成：选择 `dagre` 做前端自动布局
- [x] 技术方案文档创建
- [x] 布局算法封装实现
- [x] `Canvas.tsx` 接入 dagre 布局
- [x] 交互细节打磨（fitView、重算时机、异常回退）
- [x] 验证与回归
- [ ] 文档收口 / 标记完成

### 进度记录

| 日期 | 状态 | 说明 |
|---|---|---|
| 2026-04-30 | 已完成 | 分析现有画板：节点位置由 `Canvas.tsx` 内固定网格公式直接计算 |
| 2026-04-30 | 已完成 | 确认底层数据是 DAG，不适合强行改为严格树结构 |
| 2026-04-30 | 已完成 | 确认方案 B：引入 `dagre`，做左到右分层 DAG 布局 |
| 2026-04-30 | 进行中 | 输出本技术方案与实施计划 |
| 2026-04-30 | 已完成 | 前端安装 `dagre`，新增 `layout.ts`，完成 dagre + grid fallback 布局封装 |
| 2026-04-30 | 已完成 | `Canvas.tsx` 接入左到右自动布局，并设置左右锚点 |
| 2026-04-30 | 已完成 | 完成交互打磨：结构变化时自动 fitView，纯状态刷新不主动重置视图 |
| 2026-04-30 | 已完成 | 针对 failed 节点补充更高的布局估算，降低错误摘要挤压风险 |
| 2026-04-30 | 已完成 | Web build 两轮通过，完成基础回归验证 |

---

## 1. 背景

当前前端画板位于：

- `apps/web/src/features/canvas/Canvas.tsx`

当前节点位置生成逻辑为：

```ts
const nodeList = Object.values(nodes);
const cols = Math.ceil(Math.sqrt(nodeList.length)) || 1;

position: {
  x: (i % cols) * 260,
  y: Math.floor(i / cols) * 160,
}
```

这意味着当前布局特征是：

1. **纯前端静态网格**，不是自动图布局
2. **先左到右，再上到下**
3. **边只负责表达依赖，不参与排布**
4. 节点顺序主要由 planner 输出顺序 / graph 插入顺序决定

这在节点少时可用，但随着 DAG 复杂度上升，会出现：

- 依赖关系不直观
- 上下游位置缺乏语义
- 连线容易跨层穿插
- 视觉上不像任务流，更像卡片墙

---

## 2. 目标与非目标

## 2.1 目标

本轮希望达成：

1. **把画板改成分层 DAG 布局**
   - 默认从左到右（`LR`）
   - 上游节点在左，下游节点在右

2. **保留现有数据模型**
   - 不改变 `NodeStatus`
   - 不改变 `dependsOn: string[]`
   - 不要求后端提供坐标

3. **尽量把改动收敛在前端 Canvas**
   - 优先只改 `apps/web`
   - 尽量不影响 server / core

4. **保留现有交互**
   - 节点点击详情
   - 状态颜色与动画
   - React Flow 背景、Controls、边样式

5. **提供异常兜底**
   - dagre 布局失败时，可以安全回退到现有网格布局

## 2.2 非目标

本轮不做：

- 把 DAG 改成严格树结构
- 持久化用户拖拽后的节点位置
- 引入服务端布局计算
- 一次性重做整个画板视觉系统
- 引入比 dagre 更复杂的布局引擎（如 ELK）

---

## 3. 方案选型

## 3.1 为什么选 dagre

`dagre` 很适合当前场景：

- 输入就是节点 + 有向边
- 支持层级布局（hierarchical layout）
- 可以设定方向：
  - `LR`：左到右
  - `TB`：上到下
- 对 DAG 工作流图非常常见
- 接入 React Flow 的成本相对低

## 3.2 为什么不继续手写布局

手写一个 `level -> x / layerIndex -> y` 的简化布局并不难，但会有这些问题：

- 同层排序容易不稳定
- 多父节点汇合时容易交叉严重
- 后续节点数增多后维护成本会上升
- 要不断自己调“避免重叠 / 美观度”

如果已经决定做“方案 B”，那 `dagre` 是更稳的工程选项。

## 3.3 为什么不是严格树组件

因为底层是 DAG，不是 Tree：

- 一个节点允许多个依赖
- `dependsOn` 是数组，不是单父引用
- 强行套树结构会造成语义失真

因此，最准确的目标不是“树”，而是：

> **tree-like / flow-like 的分层 DAG 布局**

---

## 4. 总体设计

### 核心思路

把当前 `Canvas.tsx` 中“直接按索引算网格坐标”的逻辑，替换为：

1. 根据 `nodes` 生成 React Flow 节点和边的基础数据
2. 调用 `dagre` 计算每个节点的布局坐标
3. 将 dagre 输出的中心点坐标转换为 React Flow 需要的左上角坐标
4. 将结果传给 `<ReactFlow nodes={...} edges={...} />`

### 布局方向

默认采用：

- `rankdir = "LR"`

即：

- 左边是上游
- 右边是下游
- 更符合“流程推进”的阅读方向

---

## 5. 拟议代码改动

## 5.1 依赖

新增前端依赖：

- `dagre`

> 注：实现时需要确认项目当前包管理与 workspace 范围。更可能的安装位置是 `apps/web` 对应 workspace，避免把纯前端依赖加到不需要的包里。

---

## 5.2 文件建议

建议新增：

```text
apps/web/src/features/canvas/
  Canvas.tsx
  layout.ts
```

其中：

- `Canvas.tsx`：保留 UI 入口与组件逻辑
- `layout.ts`：封装 dagre 相关布局算法，避免 Canvas 文件继续膨胀

如果希望更细，也可以：

```text
apps/web/src/features/canvas/
  Canvas.tsx
  NodeCard.tsx
  NodeDetail.tsx
  layout.ts
  constants.ts
```

但本轮不是必须。

---

## 5.3 建议新增的布局函数

可新增类似 API：

```ts
export interface LayoutOptions {
  direction?: "LR" | "TB";
  nodeWidth?: number;
  nodeHeight?: number;
  rankSep?: number;
  nodeSep?: number;
}

export function buildFlowLayout(
  nodes: NodeStatus[],
  options?: LayoutOptions
): { rfNodes: Node[]; rfEdges: Edge[] }
```

或者分成两层：

```ts
export function buildCanvasEdges(nodes: NodeStatus[]): Edge[]
export function layoutCanvasNodes(nodes: Node[], edges: Edge[], options?: LayoutOptions): Node[]
```

推荐第二种，职责更清晰：

- 一层负责业务数据转 React Flow 数据
- 一层负责 React Flow 数据转布局结果

---

## 6. 详细技术设计

## 6.1 输入数据

现有 `Canvas.tsx` 已有：

- `nodes: Record<string, NodeStatus>`

可先转成：

```ts
const nodeList = Object.values(nodes);
```

边继续从 `dependsOn` 生成：

```ts
const rfEdges = nodeList.flatMap((n) =>
  n.dependsOn.map((dep) => ({
    id: `${dep}->${n.id}`,
    source: dep,
    target: n.id,
  }))
);
```

这部分与现状兼容，可基本复用。

---

## 6.2 dagre 图构建

在 `layout.ts` 中：

1. 创建 dagre graph
2. 设置全局图参数
3. 为每个节点设定尺寸
4. 写入每条边
5. 运行 `dagre.layout(graph)`

伪代码：

```ts
import dagre from "dagre";

const g = new dagre.graphlib.Graph();
g.setDefaultEdgeLabel(() => ({}));
g.setGraph({
  rankdir: "LR",
  ranksep: 120,
  nodesep: 40,
  marginx: 24,
  marginy: 24,
});

for (const node of rfNodes) {
  g.setNode(node.id, { width: 220, height: 100 });
}

for (const edge of rfEdges) {
  g.setEdge(edge.source, edge.target);
}

dagre.layout(g);
```

---

## 6.3 坐标转换

dagre 返回的是**节点中心点**。

而 React Flow `position` 需要的是**左上角**。

所以需要转换：

```ts
const positioned = rfNodes.map((node) => {
  const p = g.node(node.id);
  return {
    ...node,
    position: {
      x: p.x - NODE_WIDTH / 2,
      y: p.y - NODE_HEIGHT / 2,
    },
  };
});
```

这是接入 React Flow 时的关键细节。

---

## 6.4 节点尺寸策略

当前卡片宽度来自：

```ts
width: 220
```

高度目前并未显式固定，但视觉高度大致稳定。

为了让布局更稳定，本方案建议：

- 宽度：先保持 `220`
- 高度：先固定为一个保守值，例如 `96` 或 `100`

这样 dagre 在计算时更稳定。

### 为什么不立刻做动态高度测量

因为动态测量会引入更多复杂度：

- 需要先渲染再测量
- 需要二次布局
- 可能导致跳动

本轮优先做稳定、可控的固定尺寸布局。

后续如需优化，再考虑按内容高度动态测量。

---

## 6.5 布局失败兜底

需要保留一个 fallback：

- 如果 dagre 运行报错
- 或输入数据异常
- 或某些节点没有拿到坐标

则回退到当前网格布局。

建议保留一个纯函数：

```ts
function buildGridLayout(nodes: NodeStatus[]): Node[]
```

然后：

```ts
try {
  return buildDagreLayout(...);
} catch {
  return buildGridLayout(...);
}
```

这样可以显著降低引入新布局时的风险。

---

## 6.6 fitView 策略

当前 React Flow 已启用：

```tsx
<ReactFlow fitView ... />
```

但引入 dagre 后，要注意两个时机：

1. 初次进入 session
2. session 切换后节点数量/布局变化明显

建议：

- 第一阶段先保留现状，观察体验
- 如果发现切 session 后视口不理想，再接 `useReactFlow().fitView()` 做显式重算

因此本轮优先级：

- **P0**：先完成正确布局
- **P1**：再优化视口自动适配体验

---

## 6.7 ReactFlow 节点锚点（可选优化）

如果采用左到右布局，后续可以考虑为节点显式设置：

- `sourcePosition: Position.Right`
- `targetPosition: Position.Left`

这样边会更像流程图。

这不是必须项，但建议列为同轮可选优化。

---

## 7. 分阶段实施计划

## Phase 1：布局算法落地

目标：完成不改 UI 行为的 dagre 布局封装。

### 任务
- [ ] 新增 `layout.ts`
- [ ] 抽出当前边生成逻辑
- [ ] 新增 dagre graph 构建与坐标计算
- [ ] 新增网格 fallback 布局函数
- [ ] 为布局常量提取配置（宽高、间距、方向）

### 完成标准
- `layout.ts` 能输入当前节点数据并返回可直接渲染的 `rfNodes` / `rfEdges`
- 在异常情况下可回退到旧布局

---

## Phase 2：Canvas 接入

目标：让 `Canvas.tsx` 改用自动布局结果。

### 任务
- [ ] 用布局函数替换 `useMemo` 内网格坐标生成逻辑
- [ ] 保持 `NodeCard` / `NodeDetail` 行为不变
- [ ] 保持边样式、颜色、动画、点击交互不变
- [ ] 评估是否补充 `sourcePosition` / `targetPosition`

### 完成标准
- 页面可以正常展示分层 DAG
- 多依赖节点能正确连线
- 节点点击与详情面板不受影响

---

## Phase 3：交互打磨与验证

目标：让布局体验达到可交付状态。

### 任务
- [ ] 检查 session 切换时的 `fitView` 体验
- [ ] 检查节点少 / 节点多 / 多父依赖 / checkpoint 混合场景
- [ ] 检查 running / failed / done 状态变化是否导致不必要重排
- [ ] 必要时补充日志或调试信息

### 完成标准
- 用户能明显感知到“上游在左，下游在右”的结构
- 视图初始可读性明显优于网格布局
- 没有明显跳动、遮挡、交互回归

---

## 8. 验证清单

实现完成后，至少验证以下场景：

### 基础场景
- [ ] 1 个节点
- [ ] 2 个串行节点
- [ ] 3 个并行起点节点
- [ ] 1 个汇合节点（多 dependsOn）
- [ ] 混合 implement / checkpoint 节点

### 状态场景
- [ ] running 节点动画正常
- [ ] failed 节点错误摘要显示正常
- [ ] done / pending / blocked 颜色正常

### 交互场景
- [ ] 点击节点打开右上详情面板
- [ ] 切换 session 后画布视口合理
- [ ] React Flow 缩放/平移不异常
- [ ] Controls 和 Background 保持正常

### 回退场景
- [ ] dagre 异常时回到网格布局
- [ ] 节点数据为空时正常显示空图

---

## 9. 风险与应对

## 风险 1：节点高度估算不准，导致局部拥挤

### 应对
- 第一版固定高度
- 通过 `ranksep` / `nodesep` 留出更保守间距
- 后续若必要，再做动态测量

## 风险 2：多依赖汇合时边交叉仍然较多

### 应对
- 先接受 dagre 的默认优化
- 通过同层间距和 rank 间距微调
- 仅当确实读图困难时，再评估 ELK

## 风险 3：session 切换后视图焦点不理想

### 应对
- 初版先保留 `fitView`
- 如有问题，再补显式 `fitView()` 调用

## 风险 4：引入新依赖后构建或 workspace 边界处理不当

### 应对
- 明确把依赖安装到前端 workspace
- 实现后跑 web build 验证

## 风险 5：布局重算过于频繁导致体验跳动

### 应对
- 仅基于 `nodes` 数据变化做 `useMemo`
- 不因非结构性 UI 状态频繁重算
- 必要时只在 session 切换 / 节点集合变化时触发布局

---

## 10. 建议实现顺序

建议严格按下面顺序推进：

1. **新增 `layout.ts`，不改 Canvas 行为**
2. **写出 dagre + fallback 的纯函数**
3. **在 `Canvas.tsx` 内替换现有网格位置逻辑**
4. **跑前端构建 / 手工验图**
5. **微调间距与视口体验**

这样能保证每一步都容易回退。

---

## 11. 预计改动范围

### 必改文件
- `apps/web/src/features/canvas/Canvas.tsx`

### 建议新增文件
- `apps/web/src/features/canvas/layout.ts`

### 可能改动文件
- `apps/web/package.json` 或 workspace 对应依赖声明位置

### 原则上不应改动
- `packages/core/**`
- `apps/server/**`
- `packages/shared/**`

---

## 12. 粗略工期预估

如果只做方案 B 的基础交付，不扩展拖拽持久化等高级能力：

- 方案落地：0.5 天
- 接入与调试：0.5 天
- 验证与微调：0.5 天

**合计：约 1 ~ 2 天**

---

## 13. 实施完成后的验收标准

满足以下条件即可视为本方案完成：

1. 画板节点默认按依赖层级展示，而非简单网格
2. 大多数图中可以直观看出“从左到右”的推进方向
3. 多父依赖节点能正确汇合，不破坏原始 DAG 语义
4. 节点点击详情、状态样式、边样式保持正常
5. 无法布局时能自动回退，不影响基本使用

---

## 14. 下一步执行入口

当开始真正编码时，建议从以下入口开始：

- `apps/web/src/features/canvas/Canvas.tsx`

第一刀建议先把这里的：

```ts
position: { x: (i % cols) * 260, y: Math.floor(i / cols) * 160 }
```

替换为布局函数输出，做到“最小侵入式”接入。

---

## 15. 文档维护规则

后续推进本方案时，请同步更新：

1. **顶部“当前进度”勾选状态**
2. **进度记录表**
3. 如实现中有偏离本方案的重要决策，补充到文档末尾“决策记录”

### 决策记录

| 日期 | 决策 | 原因 |
|---|---|---|
| 2026-04-30 | 采用 dagre 而非严格树组件 | 底层是 DAG，多父依赖不适合树语义 |
| 2026-04-30 | 默认布局方向选择 LR | 更符合工作流从左向右推进的阅读习惯 |
| 2026-04-30 | 保留网格 fallback | 降低新布局引入风险，确保可回退 |

