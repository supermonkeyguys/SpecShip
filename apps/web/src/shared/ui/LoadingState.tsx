interface LoadingStateProps {
  label?: string;
  className?: string;
}

export function LoadingState({ label = "Loading", className }: LoadingStateProps) {
  return (
    <div className={`text-xs text-gray-400 animate-pulse ${className ?? ""}`} role="status" aria-live="polite">
      {label}...
    </div>
  );
}
