import { Button } from "../../../components/ui/button";
import { cn } from "../../../components/ui/utils";
import type { SessionRowVM } from "../projectPanel.types";

interface Props {
  row: SessionRowVM;
  selectionMode: boolean;
  onSelect: (row: SessionRowVM) => void;
  onToggleSelection: (row: SessionRowVM) => void;
  onToggleStar: (row: SessionRowVM) => void;
  onDelete: (row: SessionRowVM) => void;
}

const STATUS_DOT: Record<string, string> = {
  running: "bg-amber-400 animate-pulse",
  done: "bg-green-500",
  failed: "bg-red-500",
  interrupted: "bg-gray-400",
};

export function SessionRow({ row, selectionMode, onSelect, onToggleSelection, onToggleStar, onDelete }: Props) {
  return (
    <div
      className={cn(
        "group flex items-center gap-1 rounded-none py-1.5 pl-3 pr-2 text-xs",
        row.isActive && !selectionMode
          ? "border-l-2 border-blue-500 bg-blue-50 text-blue-700"
          : "border-l-2 border-transparent text-gray-600",
        row.isSelected && "bg-blue-50",
        "hover:bg-gray-100"
      )}
    >
      {selectionMode && (
        <input
          type="checkbox"
          checked={row.isSelected}
          onChange={() => onToggleSelection(row)}
          className="h-3 w-3 flex-shrink-0 cursor-pointer accent-blue-500"
          onClick={(e) => e.stopPropagation()}
        />
      )}

      <button
        type="button"
        className="flex flex-1 items-center gap-2 overflow-hidden text-left"
        onClick={() => onSelect(row)}
      >
        <span className={cn("h-1.5 w-1.5 flex-shrink-0 rounded-full", STATUS_DOT[row.status] ?? "bg-gray-300")} />
        <span className="flex-1 truncate">{row.title}</span>
      </button>

      {!selectionMode && (
        <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            title={row.starred ? "取消收藏" : "收藏"}
            className={cn(
              "h-4 w-4 p-0 text-xs",
              row.starred ? "text-amber-400 hover:text-amber-500" : "text-gray-300 hover:text-amber-400"
            )}
            onClick={(e) => { e.stopPropagation(); onToggleStar(row); }}
          >
            ★
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            title="删除会话"
            className="h-4 w-4 p-0 text-xs text-gray-300 hover:text-red-500"
            onClick={(e) => { e.stopPropagation(); onDelete(row); }}
          >
            ✕
          </Button>
        </div>
      )}
    </div>
  );
}
