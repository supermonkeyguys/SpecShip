import { TaskStrategy, ToolDef } from "./base";
import { GRAPH_PLANNER_PROMPT, IMPLEMENTER_PROMPT, REVIEWER_PROMPT, TESTER_PROMPT } from "../ai/prompts";
import type { ShipyardConfig } from "../config";

const TS_TOOLS: ToolDef[] = [
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
      description: "Search for a pattern in files within the working directory. Returns matching lines with file paths and line numbers.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Search pattern (regex or literal string)" },
          glob: { type: "string", description: "File glob pattern to limit search, e.g. '**/*.ts'. Defaults to all files." },
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
          path: { type: "string", description: "Directory path relative to working directory. Defaults to '.' (root)." },
        },
        required: [],
      },
    },
  },
];

export const typescriptLibStrategy: TaskStrategy = {
  id: "typescript-lib",
  name: "TypeScript Library",

  detect(_spec: string): number {
    // Default strategy — always viable as fallback
    return 0.5;
  },

  plan(_config: ShipyardConfig) {
    return {
      systemPrompt: GRAPH_PLANNER_PROMPT,
      allowedExtensions: [".ts", ".tsx", ".js", ".json", ".css", ".html", ".md"],
    };
  },

  tools() {
    return TS_TOOLS;
  },

  verify() {
    return {
      compile: true,
      behavior: false,
      lint: true,
      allowedCommands: ["npx tsc", "tsc", "node ", "npm install", "npm run", "npm test", "npm ci", "npx "],
    };
  },

  preview() {
    return {
      type: "code",
      previewExtensions: [".ts", ".tsx", ".js", ".json", ".md", ".html", ".css"],
    };
  },

  implementerPrompt: IMPLEMENTER_PROMPT,
  testerPrompt: TESTER_PROMPT,
  reviewerPrompt: REVIEWER_PROMPT,
};
