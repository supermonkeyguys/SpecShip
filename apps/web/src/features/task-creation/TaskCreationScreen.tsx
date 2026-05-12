import type { ActiveSession } from "../session/types";
import { TaskCreationContainer } from "./TaskCreationContainer";

interface Props {
  onRunStarted?: (session: ActiveSession) => Promise<void> | void;
}

export function TaskCreationScreen({ onRunStarted }: Props) {
  return <TaskCreationContainer onRunStarted={onRunStarted} />;
}
