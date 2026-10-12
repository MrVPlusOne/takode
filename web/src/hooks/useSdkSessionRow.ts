import { useStore } from "../store.js";
import type { SdkSessionInfo } from "../types.js";

/**
 * Subscribe to one session-list row, found by id or else by session number.
 *
 * The store keeps unchanged rows as the same objects, so the caller re-renders only
 * when its own session changes, not on every update to another session in the list.
 */
export function useSdkSessionRow(sessionId?: string | null, sessionNum?: number | null): SdkSessionInfo | null {
  return useStore((state) => {
    if (sessionId) return state.sdkSessions.find((session) => session.sessionId === sessionId) ?? null;
    if (sessionNum != null) return state.sdkSessions.find((session) => session.sessionNum === sessionNum) ?? null;
    return null;
  });
}
