interface InlineErrorProps {
  message: string;
  className?: string;
}

export function InlineError({ message, className }: InlineErrorProps) {
  return (
    <div className={`text-xs text-red-600 ${className ?? ""}`} role="alert">
      {message}
    </div>
  );
}
