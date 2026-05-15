# Compile Verification Chain — Current State

> 记录时间：2026-05-12  
> 分支：main

---

## 整体链路

```
POST /api/run (spec)
  │
  ├─ detectStrategy() → "react-app" / "typescript-lib" / ...
  │
  ├─ [react-app only] injectViteScaffold(outputDir)
  │     写入：vite.config.ts（hardcode monorepo paths）
  │           index.html（固定模板）
  │     幂等：文件已存在则跳过
  │
  └─ run(spec, config, strategy)
        │
        ├─ buildGraph() [Planner LLM]
        │     react-app 规则：禁止生成 vite.config.ts / index.html 节点
        │     允许生成：package.json, tsconfig.json, src/**, *.css ...
        │
        └─ scheduler loop（每个节点）
              │
              ├─ executeNode() [Implementer LLM]
              │     write_file 写文件到 outputDir/
              │
              ├─ verifyNode(outputFiles, workDir)
              │     │
              │     ├─ runCompileCheck(outputFiles, workDir)
              │     │     │
              │     │     ├─ getCompileBuckets(files)
              │     │     │     ├─ SKIP: vite.config.ts, tailwind.config.ts 等
              │     │     │     ├─ tsFiles: .ts / .tsx
              │     │     │     ├─ jsFiles: .js / .jsx（node --check）
              │     │     │     └─ skippedFiles: .html / .css / .json 等
              │     │     │
              │     │     └─ writeTempTsconfig(tsFiles, hasTsx, workDir)
              │     │           写 workDir/.shipyard-verify-tsconfig.json
              │     │           compilerOptions.baseUrl = monorepoRoot
              │     │           compilerOptions.paths = { "*": ["./node_modules/*"] }
              │     │           include = tsFiles（绝对路径）
              │     │           → tsc --noEmit --project <tsconfig>
              │     │           → finally: 删除临时 tsconfig
              │     │
              │     └─ runCodeReview() [Reviewer LLM]
              │           规则：只验收当前 outputFile，不检查外部文件
              │
              └─ done / retry / failed
```

---

## 已知问题

### 问题 1：pnpm 虚拟 store，三方包不在 node_modules 顶层

**现象**：`Cannot find module 'recharts'`、`Cannot find module 'react'`

**原因**：  
pnpm 使用虚拟 store（`.pnpm/`），只有项目直接声明的依赖才有顶层 symlink。  
`recharts`、`antd` 等 AI 生成代码使用的包，shipyard monorepo 本身不依赖，所以 `node_modules/recharts` 根本不存在。

`writeTempTsconfig` 的 `paths: { "*": ["./node_modules/*"] }` 无效，因为目标包不在 monorepo node_modules 里。

**影响**：所有使用 shipyard monorepo 未安装包的 AI 生成代码都会 compile fail。

**方向**：
- A. 在 session output 目录实际安装依赖（npm/pnpm install）——慢但彻底
- B. compile check 遇到 TS2307（module not found）时降级为警告而非 fail——宽松但会漏真正的错误
- C. 在 Implementer prompt 里限制 AI 只使用已在 monorepo 安装的包

---

### 问题 2：`--project` 不能混用文件参数（已修复）

**现象**：`error TS5042: Option 'project' cannot be mixed with source files`

**原因**：`buildTscCommandWithTsconfig` 之前同时传了 `--project` 和文件列表。

**修复**：文件列表通过 tsconfig 的 `include` 字段传入，命令行只传 `--project`。

---

### 问题 3：服务器不热重载 packages/core（运营问题）

**现象**：修改 `packages/core/src/` 后错误持续出现，因为 tsx watch 只监听 `apps/server/src/`。

**操作**：每次改动 `packages/core/` 需手动重启服务器。

---

### 问题 4：AI 仍会生成 scaffold 节点（prompt 层）

**现象**：`setup-vite-config`、`create-index-html` 节点仍被 Planner 生成。

**原因**：`REACT_APP_PLANNER_PROMPT` 虽已加禁止规则，但 LLM 不总是遵守。

**现状**：
- `vite.config.ts` 节点：被 `SKIP_COMPILE_FILENAMES` 跳过 compile，但 Reviewer 可能仍然 fail
- `index.html` 节点：`getCompileBuckets` 归入 skippedFiles，compile 通过，但 `ensureWritesStayWithinExpectedOutputs` 会拦截写操作（fatal）

---

## 文件归属（设计意图）

| 文件 | 写入时机 | 负责方 | 备注 |
|------|----------|--------|------|
| `vite.config.ts` | session 开始 | scaffold | hardcode monorepo paths，AI 禁止写 |
| `index.html` | session 开始 | scaffold | 固定模板，AI 禁止写 |
| `package.json` | AI 节点 | AI | spec 决定依赖 |
| `tsconfig.json` | AI 节点 | AI | spec 可配置 |
| `src/main.tsx` | AI 节点 | AI | |
| `src/**` | AI 节点 | AI | |

---

## compile check 调用栈（简化）

```
verifyNode()
  └── runCompileCheck(outputFiles, workDir)
        └── getCompileBuckets(files)
              ├── skip: SKIP_COMPILE_FILENAMES (vite.config.ts 等)
              ├── tsFiles → writeTempTsconfig() → tsc --project
              └── jsFiles → node --check
```

`writeTempTsconfig` 写入位置：`{workDir}/.shipyard-verify-tsconfig.json`  
删除时机：`finally` 块（无论成功/失败都删除）
