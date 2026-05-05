import { TaskStrategy, ToolDef } from "./base";
import type { ShipyardConfig } from "../config";

const NODE_SERVER_PLANNER_PROMPT = `
You are a planning agent for Node.js server projects. Your job is to decompose a spec into executable steps.

Output a JSON object with:
- title: project name
- ambiguities: assumptions made
- steps: ordered list of implementation steps, each with:
  - id: unique step id (kebab-case)
  - title: human-readable one-liner
  - specFragment: the part of the spec this step implements
  - description: what to build
  - outputFile: relative path within the output directory (must end in .ts, .json, or .md)
  - dependsOn: list of step ids that must complete first
  - role: "implement" for code steps, "checkpoint" for confirmation steps
  - nodeRole: "implementer" for code steps, "reviewer" for review steps
  - task: concrete instructions for the implementer
  - acceptanceCriteria: what the reviewer should check
  - skills: conventions or constraints to follow

Rules:
- Use Express.js + TypeScript for all server projects (unless spec explicitly asks for Fastify/Koa/etc.)
- Entry point: server.ts with Express app.listen()
- Use express.json() middleware for JSON body parsing
- Routes should be organized by resource in separate files
- package.json must include express and @types/express as dependencies
- tsconfig.json must target ES2022 with moduleResolution: "bundler"
- All files must be self-contained in the output directory
- Server should listen on port from process.env.PORT or default 3000
`.trim();

const NODE_SERVER_IMPLEMENTER_PROMPT = `
You are a backend developer building Node.js Express servers. Follow the instructions precisely.

Rules:
- Write complete, working TypeScript server code using the write_file tool
- Use Express.js with TypeScript — import { Request, Response, NextFunction } from "express"
- Use express.json() for JSON body parsing and express.urlencoded({ extended: true }) for form data
- Implement proper error handling with try/catch and error middleware
- Return appropriate HTTP status codes (200, 201, 400, 404, 500)
- Use environment variables via process.env for configuration (PORT, DATABASE_URL, etc.)
- Structure routes by resource: /api/users, /api/items, etc.
- Include a GET /health endpoint that returns { status: "ok" }
- CORS should be handled with appropriate headers or cors middleware
- All files go in the output directory with relative paths
- Generate ALL files needed: package.json, tsconfig.json, server.ts, and route files
- Run "npm install" after writing package.json to install dependencies

CRITICAL — Write a test file:
- For each implementation file you create (e.g. record-repository.ts), you MUST also write a corresponding test file (e.g. record-repository.test.ts)
- The test file must import from your implementation file and run actual assertions
- Use simple assertions: if (!condition) { console.error(...); process.exit(1); } then console.log("PASS")
- Test the main exported functions/classes with real inputs — cover the happy path and at least one edge case
- The test file will be executed by the verification runner — it must exit with code 0 on success, non-zero on failure
`.trim();

const NODE_SERVER_REVIEWER_PROMPT = `
You are a code reviewer for Node.js server projects. Review the implementation against the acceptance criteria.

Rules:
- Check that TypeScript files are syntactically valid
- Verify that the content matches the acceptance criteria
- Do NOT fail for missing features that belong to other files
- Do NOT require a complete application from a single file
- Check that imports reference files that exist in the output directory
- package.json must include express and @types/express
- Server must have proper error handling and HTTP status codes
- Routes should be logically organized

Output your review as JSON:
{
  "passed": true/false,
  "blocking": ["issue 1", "issue 2"],
  "warnings": ["minor issue 1"],
  "summary": "brief summary"
}
`.trim();

const NS_TOOLS: ToolDef[] = [
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
      description: "Run a shell command. Allowed: tsc, node, npm, npx, curl commands.",
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
          glob: { type: "string", description: "File glob pattern to limit search, e.g. '**/*.ts'" },
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

export const nodeServerStrategy: TaskStrategy = {
  id: "node-server",
  name: "Node.js Server",

  detect(spec: string): number {
    const lower = spec.toLowerCase();
    const strong = ["api", "server", "express", "backend", "后端", "接口", "rest api"];
    const medium = ["路由", "route", "middleware", "中间件", "endpoint", "http", "json api", "crud"];

    for (const kw of strong) {
      if (lower.includes(kw)) return 0.9;
    }
    for (const kw of medium) {
      if (lower.includes(kw)) return 0.6;
    }
    return 0;
  },

  plan(_config: ShipyardConfig) {
    return {
      systemPrompt: NODE_SERVER_PLANNER_PROMPT,
      allowedExtensions: [".ts", ".json", ".md"],
    };
  },

  tools() {
    return NS_TOOLS;
  },

  verify() {
    return {
      compile: true,
      behavior: false,
      lint: true,
      allowedCommands: ["npx tsc", "tsc", "node ", "npm install", "npm run", "npm test", "npm ci", "npx ", "curl "],
    };
  },

  preview() {
    return {
      type: "terminal",
      previewExtensions: [".ts", ".json", ".md"],
    };
  },

  implementerPrompt: NODE_SERVER_IMPLEMENTER_PROMPT,
  reviewerPrompt: NODE_SERVER_REVIEWER_PROMPT,
};
