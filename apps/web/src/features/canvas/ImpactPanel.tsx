/**
 * ImpactPanel — 节点编辑后的影响域展示
 *
 * 展示：哪些节点继续有效、哪些需要重算、为什么。
 */

import type { NodeEditImpact } from "../../types";

const KIND_LABEL: Record<string, string> = {
  content: "Content change",
  dependency: "Dependency change",
  criteria: "Criteria change",
  mixed: "Multiple changes",
};

export function ImpactPanel({ impact }: { impact: NodeEditImpact }) {
  return (
    <div className="space-y-3 text-xs">
      {/* Summary header */}
      <div className="rounded-md bg-blue-50 px-3 py-2 text-blue-800">
        <div className="font-medium mb-1">{KIND_LABEL[impact.changeKind] ?? impact.changeKind}</div>
        <div className="text-blue-600">{impact.description}</div>
        <div className="mt-1.5 flex gap-3">
          <span className="text-amber-700 font-medium">{impact.totalAffected} node{impact.totalAffected !== 1 ? "s" : ""} need rerun</span>
          <span className="text-green-700">{impact.totalUnaffected} node{impact.totalUnaffected !== 1 ? "s" : ""} unaffected</span>
        </div>
      </div>

      {/* Nodes needing rerun */}
      {impact.nodesNeedRerun.length > 0 && (
        <div>
          <div className="mb-1.5 font-medium text-amber-700 flex items-center gap-1">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500" />
            Needs Rerun
          </div>
          <div className="space-y-1">
            {impact.nodesNeedRerun.map((n) => (
              <div key={n.id} className="rounded bg-amber-50 px-2.5 py-1.5">
                <div className="font-medium text-gray-800">{n.title}</div>
                <div className="text-gray-400 mt-0.5">{n.reason}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Nodes still valid */}
      {impact.nodesStillValid.length > 0 && (
        <div>
          <div className="mb-1.5 font-medium text-green-700 flex items-center gap-1">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500" />
            Still Valid
          </div>
          <div className="space-y-1">
            {impact.nodesStillValid.map((n) => (
              <div key={n.id} className="rounded bg-green-50 px-2.5 py-1.5">
                <div className="font-medium text-gray-800">{n.title}</div>
                <div className="text-gray-400 mt-0.5">{n.reason}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
