/**
 * StatusBadge.tsx — 顶部运行状态标签
 */

import { Badge } from "./ui/badge";

interface Props {
  status: string;
}

export function StatusBadge({ status }: Props) {
  const config: Record<string, { label: string; variant: "secondary" | "warning" | "success" | "destructive" }> = {
    idle: { label: "Idle", variant: "secondary" },
    running: { label: "Running", variant: "warning" },
    done: { label: "Done", variant: "success" },
    failed: { label: "Failed", variant: "destructive" },
  };

  const { label, variant } = config[status] ?? config.idle;

  return <Badge variant={variant} className="font-mono text-[11px]">{label}</Badge>;
}
