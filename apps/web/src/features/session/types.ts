/**
 * session/types.ts — Session identity types
 */

export interface SessionRef {
  projectId: string;
  sessionId: string;
}

export type ActiveSession = SessionRef;

export type SessionKey = `${string}:${string}`;

export function toSessionKey(session: SessionRef): SessionKey;
export function toSessionKey(projectId: string, sessionId: string): SessionKey;
export function toSessionKey(
  sessionOrProjectId: SessionRef | string,
  maybeSessionId?: string
): SessionKey {
  if (typeof sessionOrProjectId === "string") {
    if (!maybeSessionId) {
      throw new Error("sessionId is required when using projectId + sessionId");
    }
    return `${sessionOrProjectId}:${maybeSessionId}` as SessionKey;
  }
  return `${sessionOrProjectId.projectId}:${sessionOrProjectId.sessionId}` as SessionKey;
}

export function sessionRefFromKey(key: SessionKey): SessionRef {
  const idx = key.indexOf(":");
  if (idx <= 0 || idx >= key.length - 1) {
    throw new Error(`Invalid session key: ${key}`);
  }
  return {
    projectId: key.slice(0, idx),
    sessionId: key.slice(idx + 1),
  };
}

export function isSameSession(a: SessionRef | null | undefined, b: SessionRef | null | undefined): boolean {
  if (!a || !b) return false;
  return a.projectId === b.projectId && a.sessionId === b.sessionId;
}
