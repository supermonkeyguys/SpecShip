# ClarificationCard 设计文档

**日期:** 2026-04-28  
**状态:** 待实现

---

## 目标

在聊天框中，当 AI 判断 spec 需要澄清时，不再以纯文字提问，而是在消息流里内嵌一张交互卡片（ClarificationCard）。用户点选或输入后提交，答案注入 spec，AI 继续执行。

---

## 交互流程

```
用户输入 spec
    ↓
Chat.tsx: POST /api/clarify
    ↓
server: CLARIFIER_PROMPT 返回结构化 questions（含 mode 判断）
    ↓
Chat.tsx: 插入 { role: "clarification", questions, answered: false }
    ↓
渲染 ClarificationCard（可交互）
    ↓
用户点确认 → onConfirm(answers)
    ↓
Chat.tsx: answers 注入 spec，消息标记 answered: true，调 runSpec
    ↓
卡片压缩为只读摘要
```

---

## 数据结构

### 新增类型（packages/shared/src/types.ts）

```typescript
export interface ClarifyOption {
  id: string;         // "a" | "b" | "c"（"other" 由前端固定注入）
  label: string;
  description: string;
}

export interface ClarifyQuestion {
  id: string;               // "q1" | "q2" ...
  text: string;
  mode: "options" | "free"; // AI 判断：选项化 or 纯文字输入
  options?: ClarifyOption[]; // mode=options 时存在，3-4 个；前端固定追加 other
}
```

### ClarifyResponse 变更

```typescript
// 修改前
questions: string[];

// 修改后
questions: ClarifyQuestion[];
```

`other` 选项不由 AI 生成，由前端在渲染时固定追加，保证永远存在。

---

## Prompt 变更（packages/core/src/prompts.ts）

`CLARIFIER_PROMPT` 输出 schema 扩展为：

```json
{
  "needsClarification": true,
  "questions": [
    {
      "id": "q1",
      "text": "问题文本",
      "mode": "options",
      "options": [
        { "id": "a", "label": "选项A", "description": "简短说明" },
        { "id": "b", "label": "选项B", "description": "简短说明" },
        { "id": "c", "label": "选项C", "description": "简短说明" }
      ]
    },
    {
      "id": "q2",
      "text": "问题文本",
      "mode": "free"
    }
  ],
  "confidence": "medium",
  "summary": "一句话摘要"
}
```

**mode 判断规则（写入 prompt）：**
- `options`：问题有 3-4 个典型答案，用户能从列表中选出来（风格、技术栈、方案类型）
- `free`：答案高度个性化、开放性强，或选项化反而限制表达（功能列表、业务规则、具体文案）

---

## 前端消息类型扩展（Chat.tsx）

```typescript
type Message =
  | { role: "user" | "ai" | "system"; text: string }
  | {
      role: "clarification";
      questions: ClarifyQuestion[];
      answered: boolean;
      answers?: Record<string, string>; // questionId → 答案文本
    };
```

渲染逻辑：
- `role === "clarification" && !answered` → `<ClarificationCard>`（可交互）
- `role === "clarification" && answered` → 只读摘要气泡

---

## 组件：ClarificationCard

**文件:** `apps/web/src/features/chat/ClarificationCard.tsx`

```typescript
interface Props {
  questions: ClarifyQuestion[];
  onConfirm: (answers: Record<string, string>) => void;
  onSkip: () => void;
}
```

### 内部状态

```typescript
const [selected, setSelected] = useState<Record<string, string>>({});
// questionId → 答案文本（选项的 label 或自由输入内容）
```

### 就绪条件

所有问题均有答案（`mode=options` 时选了选项或填了 other；`mode=free` 时输入非空）才激活确认按钮。

### 视觉状态

**待回答：**
- 白底卡片，1.5px border，14px 圆角
- header：灰底，💬 图标 + "开始之前，我需要确认几个问题"
- 每道题之间有分割线
- `mode=options`：2×N grid，选中态蓝色边框 + 蓝色文字
- "其他..." 选项点击展开 textarea
- `mode=free`：直接渲染 input，focus 时蓝色边框
- footer：右对齐，"跳过，直接开始"（灰色文字按钮）+ "确认"（蓝色，未就绪时 opacity 0.4）

**已回答（只读摘要）：**
- 绿色边框，✅ 图标 + "已确认，开始执行"
- 每道题一行：`[问题简称] → [答案]`，答案蓝色加粗

---

## 文件变更清单

| 文件 | 变更类型 | 内容 |
|------|---------|------|
| `packages/shared/src/types.ts` | 修改 | 新增 `ClarifyOption`、`ClarifyQuestion`；`ClarifyResponse.questions` 改类型 |
| `packages/core/src/prompts.ts` | 修改 | `CLARIFIER_PROMPT` 扩展输出 schema，加入 mode 判断规则 |
| `apps/server/src/routes/clarify.ts` | 修改 | 解析新 schema，透传 `ClarifyQuestion[]` |
| `apps/web/src/features/chat/Chat.tsx` | 修改 | `Message` 类型扩展，渲染分支，clarify 结果处理逻辑 |
| `apps/web/src/features/chat/ClarificationCard.tsx` | 新增 | 交互卡片组件 |

---

## 边界情况

- **clarify 接口失败**：静默降级，直接 `runSpec`，不展示卡片（现有行为保持）
- **AI 返回 `needsClarification: false`**：直接 `runSpec`，不展示卡片（现有行为保持）
- **AI 返回格式不符合新 schema**：server 端做 fallback，将 `string[]` 转为 `{ id, text, mode: "free" }[]`，保证向后兼容
- **用户点"跳过"**：以原始 spec 直接 `runSpec`，等同于原有 `just do it` 语义
- **session 切换**：`useEffect([sessionId])` 已有重置逻辑，clarification 消息随 messages 一起清空
