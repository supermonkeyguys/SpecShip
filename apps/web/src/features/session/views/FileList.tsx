import { Button } from "../../../components/ui/button";
import { Separator } from "../../../components/ui/separator";
import { cn } from "../../../components/ui/utils";
import type { FileRowVM, ProjectPanelViewProps } from "../projectPanel.types";

type Props = Pick<ProjectPanelViewProps, "fileRows" | "onSelectFile">;

export function FileList({ fileRows, onSelectFile }: Props) {
  if (fileRows.length === 0) return null;

  return (
    <>
      <Separator className="my-1" />
      <div className="px-3 py-1.5 font-semibold uppercase tracking-wider text-gray-400">Files</div>
      {fileRows.map((row: FileRowVM) => (
        <Button
          key={row.entry.path}
          type="button"
          variant="ghost"
          onClick={() => onSelectFile(row)}
          className={cn(
            "h-auto w-full justify-start gap-2 rounded-none py-1.5 pl-4 pr-3 text-left text-xs font-normal",
            row.isSelected
              ? "border-l-2 border-blue-400 bg-blue-50 text-blue-700 hover:bg-blue-50 hover:text-blue-700"
              : "text-gray-600"
          )}
        >
          <span className="flex-shrink-0 text-green-600">📄</span>
          <span className="flex-1 truncate font-mono">{row.entry.path}</span>
        </Button>
      ))}
    </>
  );
}
