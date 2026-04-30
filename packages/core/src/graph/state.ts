export type GraphStatus = "building" | "running" | "paused" | "done" | "failed";

export type SessionStatus = "running" | "paused" | "done" | "failed" | "interrupted";

export function mapGraphStatusToSessionStatus(status: GraphStatus): SessionStatus {
  switch (status) {
    case "done":
      return "done";
    case "failed":
      return "failed";
    case "paused":
      return "paused";
    case "building":
    case "running":
    default:
      return "running";
  }
}
