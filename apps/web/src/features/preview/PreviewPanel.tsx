import { useState } from "react";
import type { PreviewStatusResponse } from "../../types";
import { Button } from "../../components/ui/button";
import { Separator } from "../../components/ui/separator";
import { EmptyState } from "../../shared/ui/EmptyState";
import { InlineError } from "../../shared/ui/InlineError";
import { startSessionLivePreview, stopSessionLivePreview } from "../../shared/api/previewClient";

interface Props {
  projectId: string;
  sessionId: string;
  info: PreviewStatusResponse | null;
  onClose: () => void;
  onRefresh: (next?: PreviewStatusResponse) => Promise<void> | void;
}

export function PreviewPanel({ projectId, sessionId, info, onClose, onRefresh }: Props) {
  const [actionLoading, setActionLoading] = useState<"start" | "stop" | null>(null);
  const displayUrl = info?.liveUrl ?? info?.staticUrl ?? info?.url;

  const handleStartLive = async () => {
    setActionLoading("start");
    try {
      const next = await startSessionLivePreview(projectId, sessionId);
      await onRefresh(next);
    } finally {
      setActionLoading(null);
    }
  };

  const handleStopLive = async () => {
    setActionLoading("stop");
    try {
      const next = await stopSessionLivePreview(projectId, sessionId);
      await onRefresh(next);
    } finally {
      setActionLoading(null);
    }
  };

  if (!info) {
    return (
      <div className="flex h-full items-center justify-center bg-white">
        <EmptyState title="Loading preview" description="Checking whether this session has a previewable web output." />
      </div>
    );
  }

  if (!info.ok) {
    return (
      <div className="flex h-full flex-col bg-white">
        <Header onClose={onClose} title="Preview" subtitle="Failed to load preview state" />
        <Separator />
        <div className="p-4">
          <InlineError message={info.reason ?? "Failed to load preview."} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-white">
      <Header onClose={onClose} title="Preview" subtitle={info.liveUrl ? "Live preview" : info.entryPath ?? "Preview"} />
      <Separator />

      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 bg-gray-50 px-4 py-2 text-xs">
        {info.staticSupported && <span className="rounded-full bg-blue-50 px-2 py-1 text-blue-700">Static preview</span>}
        {info.liveSupported && (
          <span className="rounded-full bg-purple-50 px-2 py-1 text-purple-700">
            Live: {info.liveStatus ?? "idle"}
          </span>
        )}
        {info.livePort && <span className="text-gray-500">Port {info.livePort}</span>}
        {info.liveCommand && <span className="truncate text-gray-500" title={info.liveCommand}>{info.liveCommand}</span>}
        <div className="ml-auto flex items-center gap-2">
          {displayUrl && (
            <a href={displayUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
              Open raw
            </a>
          )}
          {info.liveSupported && (info.liveStatus === "running" || info.liveStatus === "starting") ? (
            <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={handleStopLive} disabled={actionLoading !== null}>
              {actionLoading === "stop" ? "Stopping..." : "Stop live"}
            </Button>
          ) : info.liveSupported ? (
            <Button type="button" size="sm" className="h-7 px-2 text-xs" onClick={handleStartLive} disabled={actionLoading !== null}>
              {actionLoading === "start" ? "Starting..." : "Start live preview"}
            </Button>
          ) : null}
        </div>
      </div>

      {info.liveError && (
        <div className="border-b border-gray-100 p-3">
          <InlineError message={info.liveError} />
        </div>
      )}

      {displayUrl ? (
        <iframe title="Session preview" src={displayUrl} className="h-full w-full border-0 bg-white" />
      ) : info.supported ? (
        <div className="flex h-full items-center justify-center p-6">
          <EmptyState
            title="Preview ready to start"
            description={info.reason ?? "This session can be previewed after starting live preview."}
          />
        </div>
      ) : (
        <div className="flex h-full items-center justify-center p-6">
          <EmptyState
            title="Preview not available"
            description={info.reason ?? "This session does not have a previewable web output yet."}
          />
        </div>
      )}
    </div>
  );
}

function Header({ title, subtitle, onClose }: { title: string; subtitle: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 bg-gray-50 px-4 py-2">
      <div className="min-w-0">
        <div className="text-xs font-semibold text-gray-700">{title}</div>
        <div className="truncate text-[11px] text-gray-500" title={subtitle}>{subtitle}</div>
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={onClose} className="h-7 px-2 text-xs">✕ Close</Button>
    </div>
  );
}
