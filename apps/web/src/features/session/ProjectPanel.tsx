/**
 * session/ProjectPanel.tsx — 左侧 Project/Session 列表
 */

import { Button } from "../../components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../components/ui/collapsible";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Separator } from "../../components/ui/separator";
import { cn } from "../../components/ui/utils";
import type { FileEntry } from "../../types";
import type { ActiveSession } from "./types";
import { useWorkspaceController } from "../../domains/workspace/controller";
import { EmptyState } from "../../shared/ui/EmptyState";

interface Props {
  activeSession: ActiveSession | null;
  onSelectSession: (session: ActiveSession) => void;
  onSelectFile: (file: FileEntry, projectId: string, sessionId: string) => void;
  onNewSession: () => void;
  selectedFilePath?: string;
}

export function ProjectPanel({ activeSession, onSelectSession, onSelectFile, onNewSession, selectedFilePath }: Props) {
  const {
    projects,
    expandedProjectId,
    sessionFiles,
    setExpandedProjectId,
  } = useWorkspaceController();

  return (
    <aside className="flex h-full flex-col border-r border-gray-200 bg-gray-50 text-xs" aria-label="Projects and sessions">
      <div className="flex items-center justify-between bg-white px-3 py-2">
        <span className="font-semibold uppercase tracking-wider text-gray-500">Projects</span>
        <Button type="button" size="sm" className="h-7 px-2 text-xs" onClick={onNewSession}>
          + New
        </Button>
      </div>

      <Separator />

      <ScrollArea className="flex-1">
        <div className="py-1">
          {projects.length === 0 ? (
            <EmptyState title="No projects yet" />
          ) : (
            projects.map((proj) => {
              const isExpanded = expandedProjectId === proj.id;

              return (
                <Collapsible
                  key={proj.id}
                  open={isExpanded}
                  onOpenChange={(open) => setExpandedProjectId(open ? proj.id : null)}
                >
                  <CollapsibleTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-auto w-full justify-start gap-1 rounded-none px-3 py-2 text-left text-xs font-medium text-gray-700"
                    >
                      <span className="text-gray-400">{isExpanded ? "▾" : "▸"}</span>
                      <span className="flex-1 truncate">{proj.name}</span>
                      <span className="flex-shrink-0 text-gray-400">{proj.sessions.length}</span>
                    </Button>
                  </CollapsibleTrigger>

                  <CollapsibleContent>
                    {proj.sessions.map((sess) => {
                      const isActive = activeSession?.sessionId === sess.id;

                      return (
                        <Button
                          key={sess.id}
                          type="button"
                          variant="ghost"
                          onClick={() => onSelectSession({ projectId: proj.id, sessionId: sess.id, spec: sess.spec })}
                          className={cn(
                            "h-auto w-full justify-start gap-2 rounded-none py-1.5 pl-6 pr-3 text-left text-xs font-normal",
                            isActive
                              ? "border-l-2 border-blue-500 bg-blue-50 text-blue-700 hover:bg-blue-50 hover:text-blue-700"
                              : "text-gray-600"
                          )}
                        >
                          <StatusDot status={sess.status} />
                          <span className="flex-1 truncate">{sess.spec.slice(0, 35)}</span>
                        </Button>
                      );
                    })}
                  </CollapsibleContent>
                </Collapsible>
              );
            })
          )}

          {activeSession && sessionFiles.length > 0 && (
            <>
              <Separator className="my-1" />
              <div className="px-3 py-1.5 font-semibold uppercase tracking-wider text-gray-400">Files</div>
              {sessionFiles.map((f) => {
                const isSelected = selectedFilePath === f.path;

                return (
                  <Button
                    key={f.path}
                    type="button"
                    variant="ghost"
                    onClick={() => onSelectFile(f, activeSession.projectId, activeSession.sessionId)}
                    className={cn(
                      "h-auto w-full justify-start gap-2 rounded-none py-1.5 pl-4 pr-3 text-left text-xs font-normal",
                      isSelected
                        ? "border-l-2 border-blue-400 bg-blue-50 text-blue-700 hover:bg-blue-50 hover:text-blue-700"
                        : "text-gray-600"
                    )}
                  >
                    <span className="flex-shrink-0 text-green-600">📄</span>
                    <span className="flex-1 truncate font-mono">{f.path}</span>
                  </Button>
                );
              })}
            </>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    running: "bg-amber-400 animate-pulse",
    done: "bg-green-500",
    failed: "bg-red-500",
    interrupted: "bg-gray-400",
  };
  return <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${colors[status] ?? "bg-gray-300"}`} />;
}
