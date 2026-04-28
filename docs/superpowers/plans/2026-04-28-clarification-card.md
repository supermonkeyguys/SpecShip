# ClarificationCard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在聊天框的消息流中，AI 提出澄清问题时渲染一张交互卡片，用户点选或输入后提交，答案注入 spec 继续执行。

**Architecture:** 扩展 `ClarifyQuestion` 类型（shared），更新 `CLARIFIER_PROMPT` 输出结构化问题 + mode 判断，server `clarify` 路由透传新结构，前端新增 `ClarificationCard` 组件，`Chat.tsx` 扩展消息类型并渲染卡片。

**Tech Stack:** TypeScript, React, Tailwind CSS (inline className), Express, pnpm monorepo

---

## File Map

| 文件 | 变更 |
|------|------|
| `packages/shared/src/types.ts` | 新增 `ClarifyOption`、`ClarifyQuestion`；`ClarifyResponse.questions` 改为 `ClarifyQuestion[]` |
| `packages/core/src/prompts.ts` | 扩展 `CLARIFIER_PROMPT` 输出 schema，加 mode 判断规则 |
| `apps/server/src/routes/clarify.ts` | 解析新 schema，fallback 兼容旧 `string[]`，透传 `ClarifyQuestion[]` |
| `apps/web/src/features/chat/ClarificationCard.tsx` | 新增：交互卡片组件 |
| `apps/web/src/features/chat/Chat.tsx` | 扩展 `Message` 类型，渲染分支，clarify 结果处理 |

---

## Task 1: 扩展共享类型

**Files:**
- Modify: `packages/shared/src/types.ts`

- [ ] **Step 1: 在 `ClarifyRequest` 前插入新类型**

在 `packages/shared/src/types.ts` 的 `// ---- Clarify API ----` 区块，将现有内容替换为：

```typescript
// ---- Clarify API ----

export interface ClarifyOption {
  id: string;         // "a" | "b" | "c"（前端固定追加 "other"）
  label: string;
  description: string;
}

export interface ClarifyQuestion {
  id: string;               // "q1" | "q2" ...
  text: string;
  mode: "options" | "free";
  options?: ClarifyOption[]; // mode=options 时存在，AI 生成 3-4 个
}

export interface ClarifyRequest {
  spec: string;
}

export interface ClarifyResponse {
  ok: boolean;
  needsClarification: boolean;
  questions: ClarifyQuestion[];
  confidence: "high" | "medium" | "low";
  summary: string;
}
```

- [ ] **Step 2: 验证类型编译**

```bash
cd /path/to/shipyard && node_modules/.bin/tsc -p tsconfig.base.json --noEmit 2>&1 | head -20
```

预期：无错误输出（或只有与本次无关的已有错误）

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types.ts
git commit -m "feat: extend ClarifyQuestion type with mode and options"
```

---

## Task 2: 更新 CLARIFIER_PROMPT

**Files:**
- Modify: `packages/core/src/prompts.ts`

- [ ] **Step 1: 替换 CLARIFIER_PROMPT**

将 `packages/core/src/prompts.ts` 中的 `CLARIFIER_PROMPT` 完整替换为：

```typescript
export const CLARIFIER_PROMPT = `
You are a software requirements analyst. Decide if a spec needs clarification, and if so, generate structured questions.

Output ONLY a JSON object:
{
  "needsClarification": true | false,
  "questions": [
    {
      "id": "q1",
      "text": "question text",
      "mode": "options" | "free",
      "options": [
        { "id": "a", "label": "Option A", "description": "brief description" },
        { "id": "b", "label": "Option B", "description": "brief description" },
        { "id": "c", "label": "Option C", "description": "brief description" }
      ]
    }
  ],
  "confidence": "high" | "medium" | "low",
  "summary": "one sentence summary of what you understood"
}

Mode selection rules:
- Use "options" when: the question has 3-4 typical answers the user can pick from (style, tech stack, approach type). Include 3-4 options in the "options" array.
- Use "free" when: the answer is highly personal, open-ended, or listing options would constrain expression (feature lists, business rules, specific copy). Omit "options" field entirely.

Rules:
- needsClarification = true ONLY if critical information is missing
- Do NOT ask about things that have reasonable defaults (TypeScript, Node.js are fine)
- Maximum 3 questions
- If needsClarification = false, questions = []
- Be decisive — most specs are clear enough to start
`.trim();
```

- [ ] **Step 2: 验证 core 编译**

```bash
node_modules/.bin/tsc -p packages/core/tsconfig.json --noEmit 2>&1 | head -20
```

预期：无错误

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/prompts.ts
git commit -m "feat: update CLARIFIER_PROMPT to output structured questions with mode"
```

---

## Task 3: 更新 server clarify 路由

**Files:**
- Modify: `apps/server/src/routes/clarify.ts`

- [ ] **Step 1: 更新 import 和解析逻辑**

将 `apps/server/src/routes/clarify.ts` 完整替换为：

```typescript
/**
 * routes/clarify.ts — POST /api/clarify
 *
 * 在正式跑任务之前，先判断 spec 是否足够清晰。
 * 前端收到 needsClarification=true 时，渲染 ClarificationCard。
 */

import { Router, Request, Response } from "express";
import { DEFAULT_CONFIG } from "../config";
import { runAgent } from "../llm";
import { CLARIFIER_PROMPT } from "../prompts";
import { ClarifyRequest, ClarifyResponse, ClarifyQuestion } from "../types";

export const clarifyRouter = Router();

clarifyRouter.post("/clarify", async (req: Request, res: Response) => {
  const { spec } = req.body as ClarifyRequest;

  if (!spec?.trim()) {
    res.status(400).json({ ok: false, needsClarification: false, questions: [], confidence: "low", summary: "" });
    return;
  }

  const config = { ...DEFAULT_CONFIG, workDir: process.cwd() };

  try {
    const { finalText } = await runAgent(
      CLARIFIER_PROMPT,
      `Spec: ${spec}`,
      config.workDir,
      { baseURL: config.baseURL, apiKey: config.apiKey, model: config.models.planning },
      false
    );

    const match = finalText.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON");

    const parsed = JSON.parse(match[0]) as {
      needsClarification: boolean;
      questions: unknown[];
      confidence: string;
      summary: string;
    };

    // Fallback：兼容旧格式 string[]，转为 free 模式问题
    const questions: ClarifyQuestion[] = (parsed.questions ?? []).map((q, i) => {
      if (typeof q === "string") {
        return { id: `q${i + 1}`, text: q, mode: "free" as const };
      }
      const typed = q as Record<string, unknown>;
      return {
        id: typeof typed.id === "string" ? typed.id : `q${i + 1}`,
        text: typeof typed.text === "string" ? typed.text : String(q),
        mode: typed.mode === "options" ? "options" as const : "free" as const,
        options: Array.isArray(typed.options) ? typed.options as ClarifyQuestion["options"] : undefined,
      };
    });

    res.json({
      ok: true,
      needsClarification: parsed.needsClarification ?? false,
      questions,
      confidence: (parsed.confidence ?? "medium") as ClarifyResponse["confidence"],
      summary: parsed.summary ?? "",
    } satisfies ClarifyResponse);
  } catch {
    res.json({
      ok: true,
      needsClarification: false,
      questions: [],
      confidence: "medium",
      summary: spec.slice(0, 80),
    } satisfies ClarifyResponse);
  }
});
```

- [ ] **Step 2: 验证 server 编译**

```bash
node_modules/.bin/tsc -p apps/server/tsconfig.json --noEmit 2>&1 | head -20
```

预期：无错误

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/routes/clarify.ts
git commit -m "feat: clarify route parses structured ClarifyQuestion, fallback for string[]"
```

---

## Task 4: 新增 ClarificationCard 组件

**Files:**
- Create: `apps/web/src/features/chat/ClarificationCard.tsx`

- [ ] **Step 1: 创建组件文件**

创建 `apps/web/src/features/chat/ClarificationCard.tsx`：

```tsx
/**
 * ClarificationCard.tsx — 澄清问题交互卡片
 *
 * 渲染一组结构化问题（选项卡 + 自由输入），用户全部填写后才能确认。
 * 由 Chat.tsx 在 role="clarification" 消息时渲染。
 */

import { useState } from "react";
import type { ClarifyQuestion } from "../../types";

interface Props {
  questions: ClarifyQuestion[];
  onConfirm: (answers: Record<string, string>) => void;
  onSkip: () => void;
}

export function ClarificationCard({ questions, onConfirm, onSkip }: Props) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [otherVisible, setOtherVisible] = useState<Record<string, boolean>>({});
  const [otherText, setOtherText] = useState<Record<string, string>>({});

  const setAnswer = (qid: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [qid]: value }));
  };

  const isReady = questions.every((q) => {
    const ans = answers[q.id];
    if (!ans) return false;
    if (ans === "__other__") return (otherText[q.id] ?? "").trim().length > 0;
    return true;
  });

  const handleConfirm = () => {
    if (!isReady) return;
    const resolved: Record<string, string> = {};
    for (const q of questions) {
      resolved[q.id] = answers[q.id] === "__other__"
        ? otherText[q.id] ?? ""
        : answers[q.id] ?? "";
    }
    onConfirm(resolved);
  };

  return (
    <div className="rounded-2xl border border-gray-200 overflow-hidden shadow-sm text-xs">
      {/* Header */}
      <div className="bg-gray-50 border-b border-gray-200 px-4 py-2.5 flex items-center gap-2 font-semibold text-gray-800">
        <span>💬</span>
        <span>开始之前，我需要确认几个问题</span>
      </div>

      {/* Questions */}
      <div className="bg-white px-4 py-3 flex flex-col gap-4">
        {questions.map((q, idx) => (
          <div key={q.id} className="flex flex-col gap-2">
            {idx > 0 && <div className="h-px bg-gray-100 -mx-4" />}
            <div className="font-semibold text-gray-800 pt-1">
              {idx + 1}. {q.text}
            </div>

            {q.mode === "options" ? (
              <>
                <div className="grid grid-cols-2 gap-1.5">
                  {(q.options ?? []).map((opt) => {
                    const selected = answers[q.id] === opt.id;
                    return (
                      <button
                        key={opt.id}
                        onClick={() => {
                          setAnswer(q.id, opt.id);
                          setOtherVisible((v) => ({ ...v, [q.id]: false }));
                        }}
                        className={`text-left rounded-xl border px-3 py-2 flex flex-col gap-0.5 transition-all ${
                          selected
                            ? "border-blue-500 bg-blue-50"
                            : "border-gray-200 bg-gray-50 hover:bg-gray-100"
                        }`}
                      >
                        <span className={`font-semibold ${selected ? "text-blue-600" : "text-gray-800"}`}>
                          {opt.label}
                        </span>
                        <span className={`text-[10.5px] leading-tight ${selected ? "text-blue-400" : "text-gray-400"}`}>
                          {opt.description}
                        </span>
                      </button>
                    );
                  })}
                  {/* 固定 Other 选项 */}
                  <button
                    onClick={() => {
                      setAnswer(q.id, "__other__");
                      setOtherVisible((v) => ({ ...v, [q.id]: true }));
                    }}
                    className={`text-left rounded-xl border px-3 py-2 flex flex-col gap-0.5 transition-all ${
                      answers[q.id] === "__other__"
                        ? "border-blue-500 bg-blue-50"
                        : "border-gray-200 bg-gray-50 hover:bg-gray-100"
                    }`}
                  >
                    <span className={`font-semibold ${answers[q.id] === "__other__" ? "text-blue-600" : "text-gray-800"}`}>
                      其他...
                    </span>
                    <span className="text-[10.5px] text-gray-400">自由描述</span>
                  </button>
                </div>
                {otherVisible[q.id] && (
                  <textarea
                    className="w-full border border-blue-400 rounded-lg px-3 py-2 text-xs bg-blue-50 outline-none resize-none h-14 font-mono"
                    placeholder="描述你的需求..."
                    value={otherText[q.id] ?? ""}
                    onChange={(e) => setOtherText((t) => ({ ...t, [q.id]: e.target.value }))}
                  />
                )}
              </>
            ) : (
              <input
                type="text"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs bg-gray-50 outline-none focus:border-blue-400 focus:bg-white font-mono transition-colors"
                placeholder="请输入..."
                value={answers[q.id] ?? ""}
                onChange={(e) => setAnswer(q.id, e.target.value)}
              />
            )}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="bg-gray-50 border-t border-gray-200 px-4 py-2.5 flex justify-end items-center gap-2">
        <button
          onClick={onSkip}
          className="text-gray-400 hover:text-gray-600 px-3 py-1.5 rounded-lg hover:bg-gray-200 transition-colors"
        >
          跳过，直接开始
        </button>
        <button
          onClick={handleConfirm}
          disabled={!isReady}
          className={`px-4 py-1.5 rounded-lg font-semibold transition-colors ${
            isReady
              ? "bg-blue-600 text-white hover:bg-blue-500"
              : "bg-blue-200 text-white cursor-not-allowed"
          }`}
        >
          确认
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 验证 web 编译**

```bash
node_modules/.bin/tsc -p apps/web/tsconfig.app.json --noEmit 2>&1 | head -20
```

预期：无错误（此时 Chat.tsx 还未 import，可能有 unused 警告，忽略）

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/chat/ClarificationCard.tsx
git commit -m "feat: add ClarificationCard component"
```

---

## Task 5: 更新 Chat.tsx

**Files:**
- Modify: `apps/web/src/features/chat/Chat.tsx`

- [ ] **Step 1: 扩展 Message 类型，新增 import**

在 `Chat.tsx` 顶部 import 区块，增加：

```typescript
import type { ClarifyQuestion } from "../../types";
import { ClarificationCard } from "./ClarificationCard";
```

将 `type Message` 定义替换为：

```typescript
type TextMessage = { role: "user" | "ai" | "system"; text: string };
type ClarificationMessage = {
  role: "clarification";
  questions: ClarifyQuestion[];
  answered: boolean;
  answers?: Record<string, string>;
};
type Message = TextMessage | ClarificationMessage;
```

- [ ] **Step 2: 替换 clarify 处理逻辑**

找到 `ChatPanel` 函数内 `clarifyData.needsClarification` 的处理分支，将其替换为：

```typescript
if (clarifyData.needsClarification && clarifyData.questions?.length) {
  setMessages((m) => [
    ...m,
    {
      role: "clarification" as const,
      questions: clarifyData.questions,
      answered: false,
    },
  ]);
  setPendingSpec({ spec: intent.spec, repoPath: intent.repoPath });
} else {
  await runSpec(intent.spec, intent.repoPath);
}
```

- [ ] **Step 3: 新增 handleClarificationConfirm / handleClarificationSkip**

在 `ChatPanel` 函数体内，`send` 函数之前，插入：

```typescript
const handleClarificationConfirm = async (answers: Record<string, string>) => {
  if (!pendingSpec) return;
  // 把 answers 注入 spec
  const answerText = Object.entries(answers)
    .map(([, v]) => v)
    .join(", ");
  const enrichedSpec = `${pendingSpec.spec}\n\nUser clarifications: ${answerText}`;
  // 锁定卡片为已回答状态
  setMessages((m) =>
    m.map((msg) =>
      msg.role === "clarification" && !msg.answered
        ? { ...msg, answered: true, answers }
        : msg
    )
  );
  setPendingSpec(null);
  setLoading(true);
  try { await runSpec(enrichedSpec, pendingSpec.repoPath); }
  finally { setLoading(false); }
};

const handleClarificationSkip = async () => {
  if (!pendingSpec) return;
  setMessages((m) =>
    m.map((msg) =>
      msg.role === "clarification" && !msg.answered
        ? { ...msg, answered: true }
        : msg
    )
  );
  setPendingSpec(null);
  setLoading(true);
  try { await runSpec(pendingSpec.spec, pendingSpec.repoPath); }
  finally { setLoading(false); }
};
```

- [ ] **Step 4: 更新消息渲染，加入 clarification 分支**

找到 messages.map 的渲染部分：

```tsx
{messages.map((m, i) => (
  <div
    key={i}
    className={`text-xs px-3 py-2 rounded-lg font-mono ${...}`}
  >
    ...
  </div>
))}
```

替换为：

```tsx
{messages.map((m, i) => {
  if (m.role === "clarification") {
    if (m.answered) {
      // 只读摘要
      return (
        <div key={i} className="rounded-2xl border border-green-300 bg-green-50 overflow-hidden text-xs">
          <div className="px-4 py-2.5 flex items-center gap-2 font-semibold text-green-700 bg-green-100 border-b border-green-200">
            <span>✅</span>
            <span>已确认，开始执行</span>
          </div>
          {m.answers && (
            <div className="px-4 py-2.5 flex flex-col gap-1.5">
              {m.questions.map((q) => (
                <div key={q.id} className="flex gap-2 text-[11px]">
                  <span className="text-gray-500 shrink-0">
                    {q.text.slice(0, 20)}{q.text.length > 20 ? "…" : ""}
                  </span>
                  <span className="text-blue-600 font-semibold">→ {m.answers![q.id]}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }
    return (
      <ClarificationCard
        key={i}
        questions={m.questions}
        onConfirm={handleClarificationConfirm}
        onSkip={handleClarificationSkip}
      />
    );
  }
  return (
    <div
      key={i}
      className={`text-xs px-3 py-2 rounded-lg font-mono ${
        m.role === "user"
          ? "bg-blue-600 text-white ml-4"
          : m.role === "ai"
          ? "bg-gray-100 text-gray-800 border border-gray-200"
          : "text-gray-400 text-center"
      }`}
    >
      {m.role === "user" ? "> " : ""}{m.text}
    </div>
  );
})}
```

- [ ] **Step 5: 验证 web 完整编译**

```bash
node_modules/.bin/tsc -p apps/web/tsconfig.app.json --noEmit 2>&1 | head -30
```

预期：无错误

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/chat/Chat.tsx
git commit -m "feat: integrate ClarificationCard into chat flow"
```

---

## Task 6: 端到端验证

- [ ] **Step 1: 启动服务**

```bash
# Terminal 1
pnpm server:dev

# Terminal 2
pnpm web:dev
```

- [ ] **Step 2: 手动测试 clarification 卡片**

1. 打开 `http://localhost:5173`
2. 在聊天框输入一个模糊 spec，例如：`帮我做一个 Apple 风格的登录页`
3. 预期：AI 返回 ClarificationCard，包含至少一个 `mode=options` 问题
4. 点选选项，填写 free 输入，点"确认"
5. 预期：卡片变为绿色已确认摘要，AI 开始执行

- [ ] **Step 3: 测试跳过**

1. 再次输入模糊 spec
2. 卡片出现后点"跳过，直接开始"
3. 预期：卡片变为只读（无 answers 显示），AI 直接开始执行

- [ ] **Step 4: 测试降级（清晰 spec）**

1. 输入清晰 spec，例如：`写一个 TypeScript 函数，接受两个数字，返回它们的和`
2. 预期：无 ClarificationCard，直接开始执行

- [ ] **Step 5: Final commit**

```bash
git add -p
git commit -m "feat: ClarificationCard — structured clarification in chat flow"
```
