import { selectExecutionByRef } from "../../../domains/execution/selectors";
import { useExecutionStore } from "../../../domains/execution/store";
import type { SessionExecutionState } from "../../../domains/execution/types";
import type { SessionRef } from "../../session/types";

export function useExecutionForSession(sessionRef?: SessionRef): SessionExecutionState | null {
  return useExecutionStore((state) => selectExecutionByRef(state, sessionRef ?? null));
}
