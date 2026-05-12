import { Button } from "../../../components/ui/button";

export function RunningStatusBanner() {
  return (
    <div
      className="px-3 py-1.5 text-xs text-amber-600 border-t border-gray-100 font-mono bg-amber-50"
      role="status"
      aria-live="polite"
    >
      ● Running
    </div>
  );
}

interface FailedSessionBannerProps {
  disabled: boolean;
  retrying: boolean;
  onRetry: () => void;
}

export function FailedSessionBanner({ disabled, retrying, onRetry }: FailedSessionBannerProps) {
  return (
    <div
      className="px-3 py-2 border-t border-red-100 bg-red-50 flex items-center justify-between gap-2"
      role="alert"
    >
      <span className="text-xs text-red-600 font-mono">● Session failed</span>
      <Button
        type="button"
        onClick={onRetry}
        disabled={disabled}
        className="h-auto rounded-lg px-3 py-1 text-xs font-medium bg-red-600 hover:bg-red-700 text-white"
      >
        {retrying ? "Retrying…" : "↺ Retry"}
      </Button>
    </div>
  );
}
