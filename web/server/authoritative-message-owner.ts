import { leaderResponseOwnerThreadKey } from "../shared/leader-thread-response-routing.js";
import { MAIN_THREAD_KEY } from "../shared/thread-window.js";
import type { ThreadRef } from "./session-types.js";

export interface MessageOwnerMetadata {
  threadKey?: string;
  questId?: string;
  threadRefs?: ReadonlyArray<ThreadRef>;
}

export interface AuthoritativeMessageOwner {
  threadKey: string;
  questId?: string;
}

/**
 * Resolve the durable, navigable destination for a persisted message. Explicit
 * attachment provenance is authoritative; backfill membership never transfers
 * ownership, and malformed legacy ownership falls back to Main.
 */
export function authoritativeMessageOwner(message: MessageOwnerMetadata): AuthoritativeMessageOwner {
  const threadKey = leaderResponseOwnerThreadKey(message) ?? MAIN_THREAD_KEY;
  return threadKey === MAIN_THREAD_KEY ? { threadKey } : { threadKey, questId: threadKey };
}
