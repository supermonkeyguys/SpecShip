import { EmptyState } from "../../../shared/ui/EmptyState";
import { SessionRow } from "./SessionRow";
import type { SessionRowVM, ProjectPanelViewProps } from "../projectPanel.types";

type Props = Pick<
  ProjectPanelViewProps,
  | "sessionRows"
  | "selectionMode"
  | "onSelectSession"
  | "onToggleSessionSelection"
  | "onToggleStar"
  | "onDeleteSession"
>;

export function SessionList({
  sessionRows,
  selectionMode,
  onSelectSession,
  onToggleSessionSelection,
  onToggleStar,
  onDeleteSession,
}: Props) {
  if (sessionRows.length === 0) {
    return <EmptyState title="No sessions yet" />;
  }

  return (
    <>
      {sessionRows.map((row: SessionRowVM) => (
        <SessionRow
          key={row.key}
          row={row}
          selectionMode={selectionMode}
          onSelect={onSelectSession}
          onToggleSelection={onToggleSessionSelection}
          onToggleStar={onToggleStar}
          onDelete={onDeleteSession}
        />
      ))}
    </>
  );
}
