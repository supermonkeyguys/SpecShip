import { useEffect, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { DialogClose, DialogDescription, DialogPortal, DialogTitle } from "../../../components/ui/dialog";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import type { NodeStatus } from "../../../types";
import { fetchSessionFileContent } from "../../../shared/api/fileClient";
import { ImpactPanel } from "../ImpactPanel";
import { STATUS_COLORS, TOOL_ICONS, isNodeActive } from "../canvas.constants";
import type { CanvasNodes, CanvasSessionRef } from "../canvas.types";
import { useNodeDetailActions } from "../hooks/useNodeDetailActions";

export function NodeDetailPanel({
  node,
  nodes,
  session,
  container,
}: {
  node: NodeStatus;
  nodes: CanvasNodes;
  session: CanvasSessionRef | null;
  container: HTMLElement | null;
}) {
  const descriptionId = `node-detail-description-${node.id}`;
  const isActive = isNodeActive(node);
  const showToolCalls =
    (isActive || node.status === "done" || node.status === "failed") && (node.toolCalls?.length ?? 0) > 0;

  const {
    retrying,
    retryError,
    verifying,
    verifyError,
    handleVerify,
    editing,
    editTitle,
    applying,
    editError,
    impact,
    setEditTitle,
    handleRetry,
    handleEditApply,
    startEditing,
    cancelEditing,
    clearImpact,
  } = useNodeDetailActions(node, session);

  const relatedTesterNodes = Object.values(nodes)
    .filter((candidate) => candidate.nodeRole === "tester" && candidate.dependsOn.includes(node.id))
    .sort((a, b) => a.title.localeCompare(b.title));

  return (
    <DialogPortal container={container ?? undefined}>
      <DialogPrimitive.Content
        aria-describedby={descriptionId}
        className="absolute right-4 top-4 z-50 max-h-[calc(100%-2rem)] w-96 overflow-y-auto rounded-xl border border-gray-200 bg-white p-4 shadow-lg focus:outline-none"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <DialogTitle className="text-sm font-semibold text-gray-900">{node.title}</DialogTitle>
          <DialogClose asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 flex-shrink-0 p-0 text-lg leading-none text-gray-400"
              aria-label="Close node details"
            >
              ×
            </Button>
          </DialogClose>
        </div>

        <DialogDescription id={descriptionId} className="sr-only">
          Node details including status, files, verifications, tester coverage, and errors.
        </DialogDescription>

        <div className="space-y-3 text-xs">
          <StatusRow node={node} />

          <DefinitionSection node={node} />

          {node.status === "blocked" && node.dependsOn.length > 0 && (
            <BlockedDependenciesSection dependencyIds={node.dependsOn} nodes={nodes} />
          )}

          {node.nodeRole === "tester" && node.dependsOn.length > 0 && (
            <TesterTargetSection dependencyIds={node.dependsOn} nodes={nodes} />
          )}

          {relatedTesterNodes.length > 0 && session && (
            <RelatedTesterSection testerNodes={relatedTesterNodes} session={session} />
          )}

          {showToolCalls && <ToolCallsSection node={node} isActive={isActive} />}

          {node.filesWritten.length > 0 && <FilesSection files={node.filesWritten} />}

          {node.verifications.length > 0 && <VerificationsSection verifications={node.verifications} />}

          {node.error && <ErrorSection error={node.error} />}

          {node.promptUsed && <PromptSection prompt={node.promptUsed} />}

          {node.status === "ready" && <div className="pt-1 text-xs text-blue-500">已加入队列，等待执行…</div>}

          {(node.status === "failed" || node.status === "running") && session && (
            <RetrySection
              retrying={retrying}
              retryError={retryError}
              status={node.status}
              onRetry={handleRetry}
            />
          )}

          {node.status === "failed" && session && (
            <ReVerifySection
              verifying={verifying}
              verifyError={verifyError}
              onVerify={handleVerify}
            />
          )}

          {session && (
            <EditSection
              editing={editing}
              editTitle={editTitle}
              applying={applying}
              editError={editError}
              impact={impact}
              onStartEditing={startEditing}
              onTitleChange={setEditTitle}
              onApply={handleEditApply}
              onCancel={cancelEditing}
              onClearImpact={clearImpact}
            />
          )}
        </div>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function StatusRow({ node }: { node: NodeStatus }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-gray-500">Status</span>
      <span
        className="rounded-full px-2 py-0.5 text-xs font-medium text-white"
        style={{ background: STATUS_COLORS[node.status] }}
      >
        {node.status}
      </span>
      {node.durationMs && <span className="ml-auto text-gray-400">{(node.durationMs / 1000).toFixed(1)}s</span>}
    </div>
  );
}

function DefinitionSection({ node }: { node: NodeStatus }) {
  const hasDefinition = Boolean(node.nodeRole || node.task || node.acceptanceCriteria || node.specFragment);
  if (!hasDefinition) return null;

  return (
    <div>
      <div className="mb-1 font-medium text-gray-500">Definition</div>
      <div className="space-y-2 rounded-md bg-gray-50 px-3 py-2">
        {node.nodeRole && (
          <div>
            <div className="mb-0.5 text-[11px] font-medium uppercase tracking-wide text-gray-400">Role</div>
            <div className="font-mono text-gray-700">{node.nodeRole}</div>
          </div>
        )}
        {node.task && (
          <div>
            <div className="mb-0.5 text-[11px] font-medium uppercase tracking-wide text-gray-400">Task</div>
            <div className="whitespace-pre-wrap break-words text-gray-700">{node.task}</div>
          </div>
        )}
        {node.acceptanceCriteria && (
          <div>
            <div className="mb-0.5 text-[11px] font-medium uppercase tracking-wide text-gray-400">Acceptance</div>
            <div className="whitespace-pre-wrap break-words text-gray-700">{node.acceptanceCriteria}</div>
          </div>
        )}
        {node.specFragment && (
          <details className="group">
            <summary className="flex list-none cursor-pointer items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-gray-400 hover:text-gray-500">
              <span className="inline-block text-gray-300 transition-transform group-open:rotate-90">▶</span>
              Spec fragment
            </summary>
            <div className="mt-1 whitespace-pre-wrap break-words text-gray-600">{node.specFragment}</div>
          </details>
        )}
      </div>
    </div>
  );
}

function BlockedDependenciesSection({
  dependencyIds,
  nodes,
}: {
  dependencyIds: string[];
  nodes: CanvasNodes;
}) {
  return (
    <div className="rounded-md bg-gray-50 px-3 py-2 text-gray-500">
      <span className="font-medium text-gray-400">Waiting for:</span>
      <ul className="mt-1 space-y-0.5 pl-1">
        {dependencyIds.map((dependencyId) => {
          const dependency = nodes[dependencyId];
          return (
            <li key={dependencyId} className="flex items-center gap-1.5">
              <span
                className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full"
                style={{ background: dependency ? STATUS_COLORS[dependency.status] : "#9ca3af" }}
              />
              <span className="truncate">{dependency?.title ?? dependencyId}</span>
              <span className="ml-auto flex-shrink-0 text-gray-300">{dependency?.status}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function TesterTargetSection({ dependencyIds, nodes }: { dependencyIds: string[]; nodes: CanvasNodes }) {
  return (
    <div>
      <div className="mb-1 font-medium text-gray-500">Test target</div>
      <div className="rounded-md bg-violet-50 px-3 py-2 text-violet-700">
        {dependencyIds.map((dependencyId) => {
          const dependency = nodes[dependencyId];
          return (
            <div key={dependencyId} className="flex items-center gap-2">
              <span className="font-medium">{dependency?.title ?? dependencyId}</span>
              {dependency && (
                <span className="rounded-full px-2 py-0.5 text-[10px] text-white" style={{ background: STATUS_COLORS[dependency.status] }}>
                  {dependency.status}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RelatedTesterSection({
  testerNodes,
  session,
}: {
  testerNodes: NodeStatus[];
  session: CanvasSessionRef;
}) {
  return (
    <div>
      <div className="mb-1 font-medium text-gray-500">Tester / Test content</div>
      <div className="space-y-2">
        {testerNodes.map((testerNode) => {
          const testFiles = testerNode.filesWritten.filter((file) => file.includes(".test.") || file.includes(".spec."));
          return (
            <div key={testerNode.id} className="rounded-md border border-violet-100 bg-violet-50/70 px-3 py-2">
              <div className="mb-1 flex items-center gap-2">
                <span className="font-medium text-violet-800">{testerNode.title}</span>
                <span className="rounded-full px-2 py-0.5 text-[10px] text-white" style={{ background: STATUS_COLORS[testerNode.status] }}>
                  {testerNode.status}
                </span>
              </div>

              {testerNode.task && (
                <div className="mb-1.5 whitespace-pre-wrap break-words text-violet-900/80">
                  {testerNode.task}
                </div>
              )}

              {testerNode.acceptanceCriteria && (
                <div className="mb-1.5 rounded bg-white/70 px-2 py-1 text-violet-900/75">
                  <span className="font-medium">Acceptance:</span> {testerNode.acceptanceCriteria}
                </div>
              )}

              {testFiles.length > 0 ? (
                <div className="space-y-1.5">
                  {testFiles.map((filePath) => (
                    <TesterFilePreview key={filePath} session={session} filePath={filePath} />
                  ))}
                </div>
              ) : (
                <div className="text-[11px] text-violet-700/70">No test file has been written yet.</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TesterFilePreview({
  session,
  filePath,
}: {
  session: CanvasSessionRef;
  filePath: string;
}) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || content !== null || error) return;

    let cancelled = false;
    fetchSessionFileContent(session.projectId, session.sessionId, filePath)
      .then((data) => {
        if (!cancelled) setContent(data.content ?? "");
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load test file.");
      });

    return () => {
      cancelled = true;
    };
  }, [open, content, error, filePath, session.projectId, session.sessionId]);

  return (
    <details
      className="group rounded border border-violet-200 bg-white/80"
      onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="flex cursor-pointer list-none items-center gap-1 px-2 py-1.5 text-[11px] font-medium text-violet-800">
        <span className="inline-block text-violet-300 transition-transform group-open:rotate-90">▶</span>
        <span className="truncate font-mono">{filePath}</span>
      </summary>
      <div className="border-t border-violet-100 px-2 py-2">
        {error ? (
          <div className="text-[11px] text-red-500">{error}</div>
        ) : content === null ? (
          <div className="text-[11px] text-violet-600/70">Loading test content…</div>
        ) : (
          <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-gray-700">
            {content}
          </pre>
        )}
      </div>
    </details>
  );
}

function ToolCallsSection({ node, isActive }: { node: NodeStatus; isActive: boolean }) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1 font-medium text-gray-500">
        {isActive && <span className="inline-block h-1.5 w-1.5 flex-shrink-0 animate-pulse rounded-full bg-amber-400" />}
        {isActive ? "In progress" : "Steps"}
      </div>
      <div className="space-y-1">
        {node.toolCalls?.map((toolCall, index) => {
          const icon = TOOL_ICONS[toolCall.tool] ?? "🔧";
          const inputSummary =
            toolCall.tool === "write_file"
              ? ((toolCall.input.path as string) ?? "")
              : toolCall.tool === "run_command"
                ? ((toolCall.input.command as string) ?? "").slice(0, 40)
                : toolCall.tool === "read_file" || toolCall.tool === "search_files"
                  ? (((toolCall.input.path as string) ?? (toolCall.input.query as string)) ?? "")
                  : JSON.stringify(toolCall.input).slice(0, 40);

          return (
            <div key={index} className={`flex items-start gap-1.5 pl-1 ${toolCall.success ? "" : "opacity-60"}`}>
              <span className="mt-0.5 flex-shrink-0">{icon}</span>
              <div className="min-w-0">
                <span className="font-medium text-gray-700">{toolCall.tool}</span>
                {inputSummary && (
                  <span className="ml-1 block truncate font-mono text-gray-400">{inputSummary}</span>
                )}
              </div>
              {!toolCall.success && <span className="ml-auto flex-shrink-0 text-red-400">✗</span>}
            </div>
          );
        })}
        {isActive && (
          <div className="flex animate-pulse items-center gap-1.5 pl-1 text-gray-400">
            <span>⋯</span>
          </div>
        )}
      </div>
    </div>
  );
}

function FilesSection({ files }: { files: string[] }) {
  return (
    <div>
      <div className="mb-1 font-medium text-gray-500">Files</div>
      {files.map((file) => {
        const name = file.split("/").pop() ?? file;
        const dir = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "";

        return (
          <div key={file} className="flex min-w-0 items-center gap-1 pl-2" title={file}>
            <span className="flex-shrink-0">📄</span>
            <span className="truncate font-mono text-green-700">{name}</span>
            {dir && <span className="truncate font-mono text-gray-400">{dir.split("/").slice(-2).join("/")}</span>}
          </div>
        );
      })}
    </div>
  );
}

function VerificationsSection({
  verifications,
}: {
  verifications: NodeStatus["verifications"];
}) {
  return (
    <div>
      <div className="mb-1 font-medium text-gray-500">Verifications</div>
      {verifications.map((verification, index) => (
        <div key={index} className="flex min-w-0 gap-1 pl-2">
          <span className={`flex-shrink-0 ${verification.passed ? "text-green-600" : "text-red-500"}`}>
            {verification.passed ? "✓" : "✗"}
          </span>
          <div className="min-w-0">
            <span className="text-gray-400">[{verification.type}]</span>{" "}
            <span className="break-words text-gray-600">{verification.summary}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function ErrorSection({ error }: { error: string }) {
  return (
    <div>
      <div className="mb-1 font-medium text-gray-500">Error</div>
      <div className="break-all rounded bg-red-50 p-2 font-mono text-red-600">{error}</div>
    </div>
  );
}

function RetrySection({
  retrying,
  retryError,
  status,
  onRetry,
}: {
  retrying: boolean;
  retryError: string | null;
  status: NodeStatus["status"];
  onRetry: () => void;
}) {
  return (
    <div className="pt-1">
      <Button
        type="button"
        variant="secondary"
        disabled={retrying}
        onClick={onRetry}
        className="h-auto w-full py-1.5 text-xs"
      >
        {retrying ? "Retrying…" : status === "running" ? "Force Retry" : "Retry"}
      </Button>
      {retryError && <div className="mt-1 text-xs text-red-500">{retryError}</div>}
    </div>
  );
}

function EditSection({
  editing,
  editTitle,
  applying,
  editError,
  impact,
  onStartEditing,
  onTitleChange,
  onApply,
  onCancel,
  onClearImpact,
}: {
  editing: boolean;
  editTitle: string;
  applying: boolean;
  editError: string | null;
  impact: Parameters<typeof ImpactPanel>[0]["impact"] | null;
  onStartEditing: () => void;
  onTitleChange: (value: string) => void;
  onApply: () => void;
  onCancel: () => void;
  onClearImpact: () => void;
}) {
  return (
    <div className="border-t border-gray-100 pt-1">
      {!editing && !impact && (
        <Button
          type="button"
          variant="outline"
          onClick={onStartEditing}
          className="h-auto w-full py-1.5 text-xs"
        >
          Edit Node
        </Button>
      )}

      {editing && (
        <div className="space-y-2">
          <Input
            value={editTitle}
            onChange={(event) => onTitleChange(event.currentTarget.value)}
            className="h-auto py-1.5 text-xs"
            placeholder="Node title"
            onKeyDown={(event) => {
              if (event.key === "Enter") onApply();
              if (event.key === "Escape") onCancel();
            }}
          />
          <div className="flex gap-1.5">
            <Button
              type="button"
              disabled={applying || !editTitle.trim()}
              onClick={onApply}
              className="h-auto flex-1 py-1 text-xs"
            >
              {applying ? "Applying…" : "Apply"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={applying}
              onClick={onCancel}
              className="h-auto py-1 text-xs text-gray-500"
            >
              Cancel
            </Button>
          </div>
          {editError && <div className="text-xs text-red-500">{editError}</div>}
        </div>
      )}

      {impact && (
        <div className="pt-1">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-gray-500">Impact Analysis</span>
            <Button
              type="button"
              variant="ghost"
              onClick={onClearImpact}
              className="h-auto p-0 text-xs text-gray-400 hover:text-gray-600"
            >
              Clear
            </Button>
          </div>
          <ImpactPanel impact={impact} />
        </div>
      )}
    </div>
  );
}

function PromptSection({ prompt }: { prompt: string }) {
  return (
    <details className="group">
      <summary className="flex list-none cursor-pointer select-none items-center gap-1 font-medium text-gray-500 hover:text-gray-700">
        <span className="inline-block text-gray-300 transition-transform group-open:rotate-90">▶</span>
        Prompt used
      </summary>
      <pre className="mt-1.5 max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded bg-gray-50 p-2 font-mono text-[10px] leading-relaxed text-gray-600">
        {prompt}
      </pre>
    </details>
  );
}

function ReVerifySection({
  verifying,
  verifyError,
  onVerify,
}: {
  verifying: boolean;
  verifyError: string | null;
  onVerify: () => void;
}) {
  return (
    <div className="pt-1">
      <Button
        type="button"
        variant="outline"
        disabled={verifying}
        onClick={onVerify}
        className="h-auto w-full border-blue-200 bg-blue-50 py-1.5 text-xs text-blue-700 hover:bg-blue-100 hover:text-blue-800"
      >
        {verifying ? "Verifying…" : "↻ Re-verify (skip re-generate)"}
      </Button>
      {verifyError && <div className="mt-1 text-xs text-red-500">{verifyError}</div>}
    </div>
  );
}
