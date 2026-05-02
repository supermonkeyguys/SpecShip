---
name: shipyard-issues
description: Use when encountering a design problem, architecture issue, recurring bug, or making a significant technical decision in the Shipyard project. Triggers on: LLM output truncation, retry storms, review misclassification, state inconsistency, intent routing errors, or any root cause analysis that reveals a structural flaw.
---

# Shipyard — Issues & Decisions Tracker

## What This Skill Does

When you hit a problem or make a non-obvious design decision, **record it immediately** in `ISSUES_AND_DECISIONS.md` at the project root.

This is the project's institutional memory. Future sessions (and future contributors) should be able to read it and understand *why* the code is the way it is.

---

## When to Trigger

Record an entry when any of these occur:

- A bug has a non-obvious root cause (not just "typo")
- A fix has tradeoffs or alternatives you considered
- You change a default value for a specific reason (e.g. `maxRetries: 2 → 5`)
- A feature is intentionally limited in scope
- You discover a structural constraint (e.g. "graph.json is written at plan time, not runtime")
- A recurring failure pattern is identified from logs
- You make a decision that future Claude would likely question or reverse

---

## How to Record

**File**: `ISSUES_AND_DECISIONS.md` at project root

### Entry Format

```markdown
### [Section] — [Short problem title] ([status])

**现象 / Symptom**
What the user/system observed. Include real session IDs if available.

**根本原因 / Root Cause**
The actual structural cause, not just "LLM wrote bad code."

**解决方案 / Solution** (已实施 ✅ / 待实施 ⬜ / 暂缓 🔮)
What was changed and in which files.

**决策 / Decision** (if applicable)
Why this approach over alternatives. What tradeoffs were accepted.
```

### Status Labels
- ✅ 已实施 — fix is in place
- ⬜ 待实施 — known issue, fix planned
- 🔮 暂缓 — acknowledged, deferred intentionally
- ❌ 无解 / 接受 — known limitation, accepted as-is

---

## Current Known Issues (Quick Reference)

> Full details in `ISSUES_AND_DECISIONS.md`. This is a summary index only.

| # | Area | Problem | Status |
|---|------|---------|--------|
| P1 | Planner | Single file too large → LLM truncation | ✅ prompt 加粒度限制 |
| P1b | Review | Reviewer 把相对路径/防御代码判为 blocking（compile通过却失败）| ✅ REVIEWER_PROMPT 加禁止规则 |
| P1c | Verify | tsc 命令缺少 --jsx → .tsx 文件 import 时报 TS6142 | ✅ 检测到 .tsx 时自动追加 --jsx react |
| P1d | Verify | tester 节点无独立执行环境 → 外部测试框架 import 必然 TS2307 | ✅ 新增 runTesterNodeVerification：symlink node_modules + vitest 实际运行 |
| P2 | Review | acceptanceCriteria 在旧 session 中缺失 → reviewer 用全局视角评判 | ✅ fallback + 15000 字节 |
| P3 | Retry | verify/review 失败后删文件 → LLM 盲改 | ✅ lastErrorKind 区分 |
| P4 | Frontend | 删除 activeSession 后引用未清空 → 400 | ✅ setActiveSession(null) |
| P5 | Chat | Policy NEW_RUN_RE 过宽 → 所有消息返回固定 reply | ✅ 删 new_run 分支走 LLM |
| P6 | Chat | resume intent 无 session 时触发 400 | ✅ 加前提条件检查 |
| P7 | State | applyRealtimeEvent 用空 projectId 创建 session | ✅ 从 event.projectId 取值 |
| P8 | Config | maxRetries 改动对已有 session 无效 | 文档说明，手动修 graph.json |
| P9 | Retry | 多节点同时 retry 竞争写 graph.json | 🔮 低频，暂未处理 |
| P10 | SSE | runResumeSession 误调 sseManager.reset() | ⬜ 待修复 |

---

## Architecture Constraints (必须了解)

读这些可以避免重复踩坑：

1. **`maxRetries` 写入时机**：Planner 阶段写入 graph.json，之后不再引用 config。改 `config.ts` 对已有 session 无效。

2. **`acceptanceCriteria` 写入时机**：Planner 阶段生成，此时依赖文件未写出，只能"猜测"。实际执行前通过 `enrichAcceptanceCriteriaFromDeps()` 用真实导出符号增强。

3. **graph.json 的 nodes 是 Map 序列化**：存储为 `[[id, node], ...]` 格式，不是普通对象。Python 读取时需 `{pair[0]: pair[1] for pair in g['nodes']}`。

4. **packages/core/src 已重构为子目录**：
   - `graph/graph.ts` — 节点类型定义
   - `orchestrator/` — 调度、执行、review、planner
   - `ai/prompts.ts` — 所有 LLM prompt
   - `persistence/` — checkpoint、project
   - 旧路径（`src/graph.ts`, `src/review.ts`）已不存在，修改前先确认路径

5. **execution.log.jsonl**：每次新 run 会清空重写，非追加。路径：`.shipyard/projects/{proj}/sessions/{sess}/execution.log.jsonl`

---

## 分析日志的方法

跑完一次 session 后：

```bash
# 快速定位失败节点
python3 -c "
import json
lines = [json.loads(l) for l in open('path/to/execution.log.jsonl') if l.strip()]
for l in lines:
    if l['event'] in ('review_result', 'verify_result') and not l.get('passed'):
        print(l['event'], l['nodeId'])
        for b in l.get('blocking', [l.get('errors','')]):
            print(' ❌', b[:120])
"
```

关键事件：
- `plan_complete` → 看节点拆分是否合理
- `node_prompt` → 看 Implementer 拿到的 context 是否正确
- `verify_result passed=false` → 编译/测试错误（客观）
- `review_result passed=false` → review blocking 原因（主观，需判断是否误判）
- `node_retry reason=review` → review 反复失败，重点关注 criteria 是否合理
