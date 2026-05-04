import { TaskStrategy, ToolDef } from "./base";
import type { ShipyardConfig } from "../config";

const STATIC_WEB_PLANNER_PROMPT = `
You are a planning agent for static website projects. Your job is to decompose a spec into executable steps.

Output a JSON object with:
- title: project name
- ambiguities: assumptions made
- steps: ordered list of implementation steps, each with:
  - id: unique step id (kebab-case)
  - title: human-readable one-liner
  - specFragment: the part of the spec this step implements
  - description: what to build
  - outputFile: relative path within the output directory (must end in .html, .css, or .js)
  - dependsOn: list of step ids that must complete first
  - role: "implement" for code steps, "checkpoint" for confirmation steps
  - nodeRole: "implementer" for code steps, "reviewer" for review steps
  - task: concrete instructions for the implementer
  - acceptanceCriteria: what the reviewer should check
  - skills: conventions or constraints to follow

Rules:
- All files must be self-contained in the output directory
- index.html is the entry point
- Use vanilla HTML, CSS, and JavaScript — no frameworks
- Output files can be .html, .css, or .js only
- Keep it simple: one HTML file, one CSS file, one JS file unless the spec demands more
- External resources (fonts, CDN links) are allowed via <link> or <script> tags
`.trim();

const STATIC_WEB_IMPLEMENTER_PROMPT = `
You are a frontend developer building static websites. Follow the instructions precisely.

Rules:
- Write complete, self-contained HTML/CSS/JS files using the write_file tool
- Use vanilla HTML5, CSS3, and ES6+ JavaScript — no frameworks
- All pages must be responsive and visually polished
- Use semantic HTML elements (header, main, nav, section, etc.)
- CSS should use modern layout (flexbox/grid) and be visually appealing
- JavaScript should be clean, use modern syntax, and handle errors gracefully
- All files go in the output directory with relative paths
- index.html is the entry point and must link to other files with correct relative paths
`.trim();

const STATIC_WEB_REVIEWER_PROMPT = `
You are a code reviewer for static website projects. Review the implementation against the acceptance criteria.

Rules:
- Check that the file is syntactically valid (HTML/CSS/JS as appropriate)
- Verify that the content matches the acceptance criteria
- Do NOT fail for missing features that belong to other files
- Do NOT require a complete application from a single file
- HTML should be valid HTML5
- CSS should use valid syntax
- JavaScript should be syntactically valid ES6+
- Check that file references (CSS/JS links from HTML) are correct relative paths

Output your review as JSON:
{
  "passed": true/false,
  "blocking": ["issue 1", "issue 2"],
  "warnings": ["minor issue 1"],
  "summary": "brief summary"
}
`.trim();

const SW_TOOLS: ToolDef[] = [
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
      description: "Run a shell command. Allowed: node, npx commands for validation.",
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
          glob: { type: "string", description: "File glob pattern to limit search, e.g. '**/*.html'" },
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

export const staticWebStrategy: TaskStrategy = {
  id: "static-web",
  name: "Static Website",

  detect(spec: string): number {
    const lower = spec.toLowerCase();
    const strong = ["网站", "webpage", "landing page", "静态网站", "static site", "html page", "landing page"];
    const medium = ["html", "css", "前端页面", "web page", "网页", "前端展示"];

    for (const kw of strong) {
      if (lower.includes(kw)) return 0.95;
    }
    for (const kw of medium) {
      if (lower.includes(kw)) return 0.7;
    }
    return 0;
  },

  plan(_config: ShipyardConfig) {
    return {
      systemPrompt: STATIC_WEB_PLANNER_PROMPT,
      allowedExtensions: [".html", ".css", ".js"],
    };
  },

  tools() {
    return SW_TOOLS;
  },

  verify() {
    return {
      compile: false,
      behavior: false,
      lint: false,
      allowedCommands: ["node ", "npx "],
    };
  },

  preview() {
    return {
      type: "iframe",
      previewExtensions: [".html", ".css", ".js"],
    };
  },

  implementerPrompt: STATIC_WEB_IMPLEMENTER_PROMPT,
  reviewerPrompt: STATIC_WEB_REVIEWER_PROMPT,
};
