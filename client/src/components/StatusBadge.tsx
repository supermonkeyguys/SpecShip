/**
 * StatusBadge.tsx — 顶部运行状态标签
 */

interface Props {
  status: string;
}

export function StatusBadge({ status }: Props) {
  const config: Record<string, { color: string; label: string }> = {
    idle:    { color: "text-gray-400",  label: "Idle" },
    running: { color: "text-amber-500", label: "● Running" },
    done:    { color: "text-green-600", label: "✓ Done" },
    failed:  { color: "text-red-500",   label: "✗ Failed" },
  };
  const { color, label } = config[status] ?? config.idle;
  return <span className={`text-xs font-mono ${color}`}>{label}</span>;
}
