/**
 * StatusBadge.tsx — 顶部运行状态标签
 */

import { StatusPill } from "../shared/ui/StatusPill";

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

  return <StatusPill label={label} variant={variant} className="font-mono text-[11px]" />;
}
