import { canonicalThreadStatusKey, type LeaderThreadStatus } from "../../shared/thread-status-marker.js";
import type { AppState } from "../store-types.js";

/** A leader thread's current status as its window and live updates brought it; null when it has none. */
export function selectThreadStatus(
  state: Pick<AppState, "threadStatuses">,
  sessionId: string,
  threadKey: string,
): LeaderThreadStatus | null {
  return state.threadStatuses?.get(sessionId)?.get(canonicalThreadStatusKey(threadKey)) ?? null;
}
