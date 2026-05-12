import { Button } from "../../../components/ui/button";
import type { ProjectPanelViewProps } from "../projectPanel.types";

type Props = Pick<
  ProjectPanelViewProps,
  | "activeSession"
  | "selectionMode"
  | "selectedCount"
  | "deleting"
  | "canEnterSelectionMode"
  | "previewInfo"
  | "onOpenSettings"
  | "onOpenPreview"
  | "onNewSession"
  | "onEnterSelectionMode"
  | "onCancelSelectionMode"
  | "onDeleteSelected"
>;

export function PanelHeader({
  activeSession,
  selectionMode,
  selectedCount,
  deleting,
  canEnterSelectionMode,
  previewInfo,
  onOpenSettings,
  onOpenPreview,
  onNewSession,
  onEnterSelectionMode,
  onCancelSelectionMode,
  onDeleteSelected,
}: Props) {
  return (
    <div className="flex items-center justify-between gap-1 bg-white px-3 py-2">
      <span className="font-semibold uppercase tracking-wider text-gray-500 text-xs">Sessions</span>
      <div className="flex items-center gap-1">
        {selectionMode ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              className="h-6 px-2 text-xs"
              onClick={onDeleteSelected}
              disabled={selectedCount === 0 || deleting}
            >
              删除{selectedCount > 0 ? `(${selectedCount})` : ""}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-6 px-2 text-xs"
              onClick={onCancelSelectionMode}
            >
              取消
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0 text-gray-500"
              onClick={onOpenSettings}
              title="Settings"
            >
              ⚙
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0 text-gray-500 disabled:opacity-40"
              onClick={onOpenPreview}
              disabled={!activeSession || !previewInfo?.supported}
              title={previewInfo?.supported ? "Open preview" : (previewInfo?.reason ?? "No preview available")}
            >
              ⬡
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-6 px-2 text-xs"
              onClick={onEnterSelectionMode}
              disabled={!canEnterSelectionMode}
            >
              批量
            </Button>
            <Button type="button" size="sm" className="h-6 px-2 text-xs" onClick={onNewSession}>
              + New
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
