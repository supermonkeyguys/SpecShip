import type { ChatIntent, ClarifyQuestion, NodeStatus } from "../types";

interface RouteIntentInput {
  message: string;
  currentNodes?: Array<Pick<NodeStatus, "id" | "title" | "status">>;
  currentSpec?: string;
}

interface ClarificationDecision {
  needsClarification: boolean;
  questions: ClarifyQuestion[];
  confidence: "high" | "medium" | "low";
  summary: string;
}

const CHINESE_RE = /[\u3400-\u9fff]/;
const STATUS_RE = /^(status|progress|what('?s| is) the status|how('?s| is) it going|进度|状态|现在怎么样|进行到哪|到哪了|情况怎么样)[?.!\s]*$/i;
const RESUME_RE = /^(resume|continue|continue run|continue task|恢复|继续|继续执行|恢复执行|接着跑|接着执行)[!.?\s]*$/i;
const RETRY_RE = /(retry|rerun|re-run|try again|重试|重跑|重新跑)/i;
const NEW_RUN_RE = /(build|create|make|implement|design|develop|generate|scaffold|set up|start|add|refactor|redesign|website|blog|landing page|dashboard|app|system|saas|官网|网站|博客|页面|应用|系统|平台|项目|实现|创建|新建|生成|开发|搭建|设计|做一个|做个|帮我做|我想做|我想实现|加上|补充|增加|调整|优化|重构)/i;
const WEBSITE_RE = /(website|blog|landing page|homepage|home page|portfolio|marketing site|site|官网|网站|博客|主页|落地页|首页)/i;
const APP_RE = /(dashboard|admin|cms|app|system|platform|saas|workspace|portal|管理系统|后台|系统|平台|应用|工作台)/i;
const WEBSITE_SCOPE_RE = /(article|post|detail|about|archive|tag|search|comment|newsletter|mdx|markdown|cms|admin|dashboard|登录|注册|后台|文章详情|文章列表|关于|归档|标签|搜索|评论|订阅)/i;
const APP_SCOPE_RE = /(login|auth|permission|billing|payment|role|dashboard|settings|analytics|database|api|crud|workflow|登录|鉴权|权限|支付|账单|设置|分析|数据库|接口|工作流)/i;

function isChinese(text: string): boolean {
  return CHINESE_RE.test(text);
}

function say(message: string, zh: string, en: string): string {
  return isChinese(message) ? zh : en;
}

function normalizeMessage(message: string): string {
  return message.trim().replace(/\s+/g, " ").toLowerCase();
}

function extractRepoPath(message: string): string | undefined {
  const patterns = [
    /(?:in|inside|under)\s+repo\s+([~/.][^\s,，;；]+)/i,
    /repo\s*:\s*([~/.][^\s,，;；]+)/i,
    /仓库[:：]?\s*([~/.][^\s,，;；]+)/,
    /项目目录[:：]?\s*([~/.][^\s,，;；]+)/,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match?.[1]) return match[1];
  }

  return undefined;
}

function matchRetryNode(
  message: string,
  currentNodes: Array<Pick<NodeStatus, "id" | "title" | "status">>
): ChatIntent | null {
  if (!RETRY_RE.test(message)) return null;

  const lowered = normalizeMessage(message);
  const failedNodes = currentNodes.filter((node) => node.status === "failed");

  const directMatch = currentNodes.find((node) => {
    const id = node.id.toLowerCase();
    const title = node.title.toLowerCase();
    return lowered.includes(id) || title.split(/\s+/).some((part) => part.length > 2 && lowered.includes(part));
  });

  if (directMatch) {
    return {
      type: "retry_node",
      nodeId: directMatch.id,
      reply: say(message, `收到，我来重试节点 ${directMatch.id}。`, `Got it — I'll retry node ${directMatch.id}.`),
    };
  }

  if (failedNodes.length === 1) {
    return {
      type: "retry_node",
      nodeId: failedNodes[0].id,
      reply: say(message, `收到，我来重试失败节点 ${failedNodes[0].id}。`, `Got it — I'll retry the failed node ${failedNodes[0].id}.`),
    };
  }

  return null;
}

export function routeIntentByPolicy(input: RouteIntentInput): ChatIntent | null {
  const rawMessage = input.message.trim();
  if (!rawMessage) return null;

  const message = normalizeMessage(rawMessage);

  if (STATUS_RE.test(message)) {
    return {
      type: "status",
      reply: say(rawMessage, "收到，我来查看当前执行状态。", "Sure — I'll check the current execution status."),
    };
  }

  if (RESUME_RE.test(message)) {
    // 只有当前真的有未完成节点时才触发 resume，否则让 LLM 正常回答
    const hasResumable = (input.currentNodes ?? []).some(
      (n) => n.status === "failed" || n.status === "running"
    );
    if (hasResumable && input.currentSpec) {
      return {
        type: "resume",
        reply: say(rawMessage, "收到，我继续当前可恢复的任务。", "Sure — I'll resume the current recoverable task."),
      };
    }
    // 没有可恢复内容，交给 LLM 回答（避免触发无效 resume 请求）
    return null;
  }

  const retryIntent = matchRetryNode(rawMessage, input.currentNodes ?? []);
  if (retryIntent) return retryIntent;

  // new_run 及其他所有意图一律交给 LLM 判断，避免正则误匹配导致复用固定回复
  return null;
}

function summarize(message: string): string {
  const trimmed = message.trim();
  return trimmed.length <= 80 ? trimmed : `${trimmed.slice(0, 77)}...`;
}

function buildWebsiteClarificationQuestions(message: string): ClarifyQuestion[] {
  if (isChinese(message)) {
    return [
      {
        id: "scope",
        text: "你希望这个博客网站的范围到哪一层？",
        mode: "options",
        options: [
          { id: "marketing-blog", label: "展示型博客", description: "首页 + 文章列表 + 文章详情，偏内容展示" },
          { id: "brand-blog", label: "品牌博客", description: "在博客基础上，包含 About / 联系方式等品牌页" },
          { id: "blog-with-admin", label: "博客 + 后台", description: "除前台博客外，还需要内容管理后台 / CMS" },
        ],
      },
      {
        id: "visual-style",
        text: "你说的 Apple 风格更偏向哪种视觉方向？",
        mode: "options",
        options: [
          { id: "minimal", label: "极简留白", description: "干净、克制、注重排版与呼吸感" },
          { id: "product-launch", label: "产品发布页感", description: "大段 hero、强视觉层次、偏 Apple 官网叙事" },
          { id: "glass", label: "轻玻璃拟态", description: "适度半透明、圆角、柔和层次，但保持克制" },
        ],
      },
      {
        id: "content-source",
        text: "内容管理方式你希望采用哪种？",
        mode: "options",
        options: [
          { id: "static", label: "先做静态内容", description: "先把页面与文章展示做出来，内容可写死" },
          { id: "mdx", label: "Markdown/MDX", description: "文章来自本地文件，适合技术博客" },
          { id: "cms", label: "需要 CMS/后台", description: "后续希望可视化管理文章与内容" },
        ],
      },
    ];
  }

  return [
    {
      id: "scope",
      text: "What scope do you want for this blog website?",
      mode: "options",
      options: [
        { id: "marketing-blog", label: "Content blog", description: "Home + article list + article detail pages" },
        { id: "brand-blog", label: "Brand blog", description: "Blog plus About / contact / brand pages" },
        { id: "blog-with-admin", label: "Blog + admin", description: "Public blog plus a content management backend / CMS" },
      ],
    },
    {
      id: "visual-style",
      text: "Which Apple-like visual direction do you mean most?",
      mode: "options",
      options: [
        { id: "minimal", label: "Minimal whitespace", description: "Clean, restrained, typography-led" },
        { id: "product-launch", label: "Launch-page feel", description: "Large hero sections and Apple-style storytelling" },
        { id: "glass", label: "Light glassmorphism", description: "Soft translucency and rounded layers, still restrained" },
      ],
    },
    {
      id: "content-source",
      text: "How should content be managed?",
      mode: "options",
      options: [
        { id: "static", label: "Static first", description: "Build the pages first with hardcoded content" },
        { id: "mdx", label: "Markdown/MDX", description: "Articles come from local files, good for developer blogs" },
        { id: "cms", label: "CMS/backend", description: "You want a visual content management workflow later" },
      ],
    },
  ];
}

function buildAppClarificationQuestions(message: string): ClarifyQuestion[] {
  if (isChinese(message)) {
    return [
      {
        id: "primary-scope",
        text: "你希望第一阶段优先落地哪类核心功能？",
        mode: "options",
        options: [
          { id: "dashboard", label: "核心工作台", description: "先搭好主界面与核心操作流" },
          { id: "crud", label: "数据管理", description: "先把列表 / 详情 / 新增编辑这类 CRUD 跑通" },
          { id: "workflow", label: "流程协作", description: "先做状态流转、审批、协作等流程能力" },
        ],
      },
      {
        id: "auth-data",
        text: "第一阶段是否需要登录、权限或数据持久化？",
        mode: "options",
        options: [
          { id: "ui-only", label: "先只做前端壳层", description: "优先把交互和界面搭出来，不接真实数据" },
          { id: "basic-auth", label: "基础登录 + 数据", description: "需要基本账户体系与数据读写" },
          { id: "multi-role", label: "多角色权限", description: "需要区分管理员 / 成员等角色能力" },
        ],
      },
      {
        id: "visual-priority",
        text: "你当前更看重哪类交付目标？",
        mode: "options",
        options: [
          { id: "function-first", label: "功能优先", description: "先保证主流程可用，再逐步打磨视觉" },
          { id: "balanced", label: "功能 + 视觉平衡", description: "核心流程与界面品质同时兼顾" },
          { id: "design-first", label: "视觉样板优先", description: "先做一个完整高保真方向，再补实现" },
        ],
      },
    ];
  }

  return [
    {
      id: "primary-scope",
      text: "Which core capability should the first phase focus on?",
      mode: "options",
      options: [
        { id: "dashboard", label: "Main workspace", description: "Prioritize the primary UI and core interaction flow" },
        { id: "crud", label: "Data management", description: "Prioritize list / detail / create / edit CRUD flows" },
        { id: "workflow", label: "Workflow/collaboration", description: "Prioritize status flow, approvals, or collaboration" },
      ],
    },
    {
      id: "auth-data",
      text: "Does phase one need auth, permissions, or real data persistence?",
      mode: "options",
      options: [
        { id: "ui-only", label: "UI shell first", description: "Build the interaction shell first without real data" },
        { id: "basic-auth", label: "Basic auth + data", description: "Include a basic account flow and persisted data" },
        { id: "multi-role", label: "Multi-role access", description: "Include admin/member role separation" },
      ],
    },
    {
      id: "visual-priority",
      text: "What is the priority for this delivery?",
      mode: "options",
      options: [
        { id: "function-first", label: "Function first", description: "Get the core workflow working before polishing visuals" },
        { id: "balanced", label: "Balanced", description: "Balance core workflow and UI quality" },
        { id: "design-first", label: "Design first", description: "Start with a polished visual direction, then deepen implementation" },
      ],
    },
  ];
}

export function decideClarificationByPolicy(message: string): ClarificationDecision | null {
  const rawMessage = message.trim();
  if (!rawMessage) return null;

  const looksLikeWebsite = WEBSITE_RE.test(rawMessage);
  const looksLikeApp = APP_RE.test(rawMessage);

  if (looksLikeWebsite && !WEBSITE_SCOPE_RE.test(rawMessage)) {
    return {
      needsClarification: true,
      questions: buildWebsiteClarificationQuestions(rawMessage),
      confidence: "high",
      summary: summarize(rawMessage),
    };
  }

  if (!looksLikeWebsite && looksLikeApp && !APP_SCOPE_RE.test(rawMessage)) {
    return {
      needsClarification: true,
      questions: buildAppClarificationQuestions(rawMessage),
      confidence: "high",
      summary: summarize(rawMessage),
    };
  }

  return null;
}
