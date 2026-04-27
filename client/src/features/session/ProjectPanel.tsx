/**
 * session/ProjectPanel.tsx — 左侧 Project/Session 列表
 */

import { useEffect, useState } from "react";
import type { ProjectsResponse, FileEntry } from "../../../../server/types";
import { fetchJSON } from "../../utils/fetchJSON";
import type { ActiveSession } from "./types";

interface Props {
  activeSession: ActiveSession | null;
  onSelectSession: (session: ActiveSession) => void;
  onSelectFile: (file: FileEntry, projectId: string, sessionId: string) => void;
  onNewSession: () => void;
  selectedFilePath?: string;
}

export function ProjectPanel({ activeSession, onSelectSession, onSelectFile, onNewSession, selectedFilePath }: Props) {
  const [data, setData] = useState<ProjectsResponse["projects"]>([]);
  const [expandedProject, setExpandedProject] = useState<string | null>(null);
  const [sessionFiles, setSessionFiles] = useState<FileEntry[]>([]);

  useEffect(() => {
    const load = () =>
      fetchJSON<ProjectsResponse>("/api/projects")
        .then((d) => {
          setData(d.projects ?? []);
          if (!expandedProject && d.projects?.length) {
            setExpandedProject(d.projects[0].id);
          }
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!activeSession) { setSessionFiles([]); return; }
    const { projectId, sessionId } = activeSession;
    const load = () =>
      fetchJSON<{ files: FileEntry[] }>(`/api/projects/${projectId}/sessions/${sessionId}/files`)
        .then((d) => setSessionFiles(d.files ?? []))
        .catch(() => {});
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [activeSession?.projectId, activeSession?.sessionId]);

  return (
    <div className="h-full bg-gray-50 border-r border-gray-200 flex flex-col text-xs">
      <div className="px-3 py-2 border-b border-gray-200 bg-white flex items-center justify-between">
        <span className="text-gray-500 font-semibold uppercase tracking-wider">Projects</span>
        <button
          onClick={onNewSession}
          className="text-xs px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors font-medium"
        >
          + New
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {data.length === 0 ? (
          <div className="text-gray-400 px-3 py-4 text-center">No projects yet</div>
        ) : (
          data.map((proj) => (
            <div key={proj.id}>
              <button
                onClick={() => setExpandedProject(expandedProject === proj.id ? null : proj.id)}
                className="w-full flex items-center gap-1 px-3 py-2 hover:bg-gray-100 text-left"
              >
                <span className="text-gray-400">{expandedProject === proj.id ? "▾" : "▸"}</span>
                <span className="text-gray-700 font-medium truncate flex-1">{proj.name}</span>
                <span className="text-gray-400 flex-shrink-0">{proj.sessions.length}</span>
              </button>

              {expandedProject === proj.id && proj.sessions.map((sess) => {
                const isActive = activeSession?.sessionId === sess.id;
                return (
                  <button
                    key={sess.id}
                    onClick={() => onSelectSession({ projectId: proj.id, sessionId: sess.id, spec: sess.spec })}
                    className={`w-full flex items-center gap-2 pl-6 pr-3 py-1.5 text-left transition-colors ${
                      isActive ? "bg-blue-50 border-l-2 border-blue-500" : "hover:bg-gray-100"
                    }`}
                  >
                    <StatusDot status={sess.status} />
                    <span className={`truncate flex-1 ${isActive ? "text-blue-700" : "text-gray-600"}`}>
                      {sess.spec.slice(0, 35)}
                    </span>
                  </button>
                );
              })}
            </div>
          ))
        )}

        {activeSession && sessionFiles.length > 0 && (
          <div className="border-t border-gray-200 mt-1">
            <div className="px-3 py-1.5 text-gray-400 uppercase tracking-wider font-semibold">Files</div>
            {sessionFiles.map((f) => (
              <button
                key={f.path}
                onClick={() => onSelectFile(f, activeSession.projectId, activeSession.sessionId)}
                className={`w-full flex items-center gap-2 pl-4 pr-3 py-1.5 text-left transition-colors ${
                  selectedFilePath === f.path
                    ? "bg-blue-50 text-blue-700 border-l-2 border-blue-400"
                    : "hover:bg-gray-100 text-gray-600"
                }`}
              >
                <span className="text-green-600 flex-shrink-0">📄</span>
                <span className="font-mono truncate flex-1">{f.path}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    running:     "bg-amber-400 animate-pulse",
    done:        "bg-green-500",
    failed:      "bg-red-500",
    interrupted: "bg-gray-400",
  };
  return <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${colors[status] ?? "bg-gray-300"}`} />;
}
