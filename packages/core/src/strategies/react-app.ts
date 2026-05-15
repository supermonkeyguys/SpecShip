import { TaskStrategy, ToolDef } from "./base";
import { TESTER_PROMPT } from "../ai/prompts";
import type { ShipyardConfig } from "../config";

const REACT_APP_PLANNER_PROMPT = `
You are a planning agent for React application projects. Your job is to decompose a spec into executable steps.

Output a JSON object with:
- title: project name
- ambiguities: assumptions made
- steps: ordered list of implementation steps, each with:
  - id: unique step id (kebab-case)
  - title: human-readable one-liner
  - specFragment: the part of the spec this step implements
  - description: what to build
  - outputFile: relative path within the output directory (must end in .tsx, .ts, .css, .json, or .html)
  - dependsOn: list of step ids that must complete first
  - role: "implement" for code steps, "checkpoint" for confirmation steps
  - nodeRole: "implementer" for code steps, "reviewer" for review steps
  - task: concrete instructions for the implementer
  - acceptanceCriteria: what the reviewer should check
  - skills: conventions or constraints to follow

Rules:
- Use Vite + React + TypeScript for all projects
- Entry point: src/main.tsx renders <App/> to #root
- Component files go in src/components/ or src/ as appropriate
- package.json must include react, react-dom as dependencies and vite, @vitejs/plugin-react as devDependencies
- tsconfig.json must target ES2022 with jsx: "react-jsx"
- All files must be self-contained in the output directory
- Bootstrap files such as package.json, tsconfig.json, src/main.tsx, and src/App.tsx must appear at most once in the plan
- Never create two steps that write the same outputFile
- SCAFFOLD FILES (do NOT include steps for these — they are injected automatically by the runtime):
  - vite.config.ts — automatically created with correct monorepo paths; any step that writes this file will FAIL
  - index.html — automatically created with <div id="root"> and correct script tag; any step that writes this file will FAIL
`.trim();

const REACT_APP_IMPLEMENTER_PROMPT = `
You are a React developer building TypeScript React applications. Follow the instructions precisely.

Rules:
- Write complete, working React components using the write_file tool
- Use React 19 with TypeScript — always use React.JSX.Element for component return types (NOT JSX.Element which is removed in React 19)
- Use functional components with hooks (useState, useEffect, useCallback, useMemo)
- Use proper TypeScript types for all props, state, and event handlers
- Components should be well-structured, responsive, and visually polished
- Use CSS modules or inline styles — keep styling self-contained
- All files go in the output directory with relative paths
- Generate ALL files needed: package.json, vite.config.ts, tsconfig.json, index.html, src/main.tsx, src/App.tsx, and any component files
- Run "npm install" after writing package.json, then "npm run build" to verify compilation
- JSX must use React.JSX.Element not global JSX.Element (React 19 breaking change)

Verification priorities:
- First ensure the generated files are structurally correct: imports resolve, TypeScript compiles, and the app can build
- You MAY add test files when they are lightweight and obvious
- Do NOT block delivery on writing DOM-heavy or interaction-heavy tests in this pass; those can be added by a later tester pass
- Prefer decomposed components and stable props/interfaces so later tests are easy to add
`.trim();

const REACT_APP_REVIEWER_PROMPT = `
You are a code reviewer for React application projects. Review the implementation against the acceptance criteria.

Rules:
- Check that TypeScript/TSX files are syntactically valid and follow React 19 conventions
- Verify that the content matches the acceptance criteria
- Do NOT fail for missing features that belong to other files
- Do NOT require a complete application from a single file
- Components must use React.JSX.Element return type, not JSX.Element
- Only check imports for files that are produced by THIS step's outputFile
- NEVER fail because vite.config.ts, index.html, or other scaffold files are absent — these are injected automatically
- NEVER require files outside the current step's outputFile to exist

Output your review as JSON:
{
  "passed": true/false,
  "blocking": ["issue 1", "issue 2"],
  "warnings": ["minor issue 1"],
  "summary": "brief summary"
}
`.trim();

const REACT_TOOLS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Write content to a file. Creates parent directories if needed.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path relative to working directory" },
          content: { type: "string", description: "Complete file content" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read content from a file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path to read" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description: "Run a shell command. Allowed: tsc, node, npm, npx commands.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Command to run" },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description: "Search for a pattern in files within the working directory.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Search pattern (regex or literal string)" },
          glob: { type: "string", description: "File glob pattern to limit search, e.g. '**/*.tsx'" },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_dir",
      description: "List files and directories at a given path within the working directory.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Directory path relative to working directory. Defaults to '.'" },
        },
        required: [],
      },
    },
  },
];

export const reactAppStrategy: TaskStrategy = {
  id: "react-app",
  name: "React Application",

  detect(spec: string): number {
    const lower = spec.toLowerCase();
    const strong = [
      "react",
      "spa",
      "dashboard",
      "前端应用",
      "single page app",
      "react app",
      "落地页",
      "营销页",
      "宣传页",
      "官网",
      "saas 官网",
      "landing page",
      "marketing site",
    ];
    const medium = [
      "组件",
      "component",
      "hook",
      "jsx",
      "tsx",
      "typescript",
      "vite",
      "前端框架",
      "状态管理",
      "router",
    ];

    for (const kw of strong) {
      if (lower.includes(kw)) return 0.9;
    }
    for (const kw of medium) {
      if (lower.includes(kw)) return 0.65;
    }
    return 0;
  },

  plan(_config: ShipyardConfig) {
    return {
      systemPrompt: REACT_APP_PLANNER_PROMPT,
      allowedExtensions: [".tsx", ".ts", ".css", ".json", ".html"],
    };
  },

  tools() {
    return REACT_TOOLS;
  },

  verify() {
    return {
      compile: true,
      behavior: false,
      lint: true,
      allowedCommands: ["npx tsc", "tsc", "node ", "npm install", "npm run", "npm test", "npm ci", "npx vite", "npx "],
    };
  },

  preview() {
    return {
      type: "iframe",
      previewExtensions: [".tsx", ".ts", ".css", ".html", ".json"],
    };
  },

  implementerPrompt: REACT_APP_IMPLEMENTER_PROMPT,
  testerPrompt: TESTER_PROMPT,
  reviewerPrompt: REACT_APP_REVIEWER_PROMPT,
};
