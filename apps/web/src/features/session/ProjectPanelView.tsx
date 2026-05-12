import { ScrollArea } from "../../components/ui/scroll-area";
import { Separator } from "../../components/ui/separator";
import { PanelHeader } from "./views/PanelHeader";
import { SessionList } from "./views/SessionList";
import { FileList } from "./views/FileList";
import type { ProjectPanelViewProps } from "./projectPanel.types";

export function ProjectPanelView({
  activeSession,
  sessionRows,
  fileRows,
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
  onSelectSession,
  onToggleSessionSelection,
  onToggleStar,
  onDeleteSession,
  onSelectFile,
}: ProjectPanelViewProps) {
  return (
    <aside className="flex h-full flex-col border-r border-gray-200 bg-gray-50 text-xs" aria-label="Projects and sessions">
      <PanelHeader
        activeSession={activeSession}
        selectionMode={selectionMode}
        selectedCount={selectedCount}
        deleting={deleting}
        canEnterSelectionMode={canEnterSelectionMode}
        previewInfo={previewInfo}
        onOpenSettings={onOpenSettings}
        onOpenPreview={onOpenPreview}
        onNewSession={onNewSession}
        onEnterSelectionMode={onEnterSelectionMode}
        onCancelSelectionMode={onCancelSelectionMode}
        onDeleteSelected={onDeleteSelected}
      />

      <Separator />

      <ScrollArea className="flex-1">
        <div className="py-1">
          <SessionList
            sessionRows={sessionRows}
            selectionMode={selectionMode}
            onSelectSession={onSelectSession}
            onToggleSessionSelection={onToggleSessionSelection}
            onToggleStar={onToggleStar}
            onDeleteSession={onDeleteSession}
          />

          {activeSession && (
            <FileList fileRows={fileRows} onSelectFile={onSelectFile} />
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}
