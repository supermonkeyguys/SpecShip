import type { TaskStrategy, ToolDef } from "../strategies/base";

export interface NodeRolePolicy {
  systemPrompt: string;
  tools: ToolDef[];
  roleLabel: string;
}

export function getNodeRolePolicy(nodeRole: string | undefined, strategy: TaskStrategy): NodeRolePolicy {
  const role = nodeRole ?? "implementer";
  const tools = strategy.tools();

  if (role === "tester") {
    return {
      systemPrompt: strategy.testerPrompt ?? strategy.implementerPrompt,
      tools,
      roleLabel: role,
    };
  }

  return {
    systemPrompt: strategy.implementerPrompt,
    tools,
    roleLabel: role,
  };
}
