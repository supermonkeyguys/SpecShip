import { Badge } from "../../components/ui/badge";

type StatusVariant = "secondary" | "warning" | "success" | "destructive";

interface StatusPillProps {
  label: string;
  variant: StatusVariant;
  className?: string;
}

export function StatusPill({ label, variant, className }: StatusPillProps) {
  return (
    <Badge variant={variant} className={className}>
      {label}
    </Badge>
  );
}
