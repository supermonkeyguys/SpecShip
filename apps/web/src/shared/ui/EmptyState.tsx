import type { ReactNode } from "react";

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, icon, className }: EmptyStateProps) {
  return (
    <div className={`px-3 py-4 text-center ${className ?? ""}`}>
      {icon ? <div className="mb-1 text-gray-400">{icon}</div> : null}
      <div className="text-gray-500">{title}</div>
      {description ? <div className="mt-1 text-[11px] text-gray-400">{description}</div> : null}
    </div>
  );
}
