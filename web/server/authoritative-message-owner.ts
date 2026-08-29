import { normalizeThreadTarget } from "../shared/thread-routing.js";
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
 * Resolve the durable, navigable destination for a persisted message.
 *
 * Explicit attachment provenance is authoritative over the message's original
 * route, but backfill memberships are intentionally excluded: they make a
 * message visible in another tab without transferring ownership. All Threads
 * is an aggregate projection rather than a destination, so malformed or legacy
 * aggregate ownership falls back to Main instead of becoming navigable state.
 */
export function authoritativeMessageOwner(message: MessageOwnerMetadata): AuthoritativeMessageOwner {
  const attached = newestAuthoritativeThreadRef(message.threadRefs ?? []);
  if (attached) return attached.owner;

  return ownerFromRoute(message.threadKey, message.questId) ?? { threadKey: MAIN_THREAD_KEY };
}

function newestAuthoritativeThreadRef(
  refs: ReadonlyArray<ThreadRef>,
): { owner: AuthoritativeMessageOwner; attachedAt: number; index: number } | null {
  let newest: { owner: AuthoritativeMessageOwner; attachedAt: number; index: number } | null = null;

  for (let index = 0; index < refs.length; index += 1) {
    const ref = refs[index]!;
    if (ref.source === "backfill") continue;
    const owner = ownerFromRoute(ref.threadKey, ref.questId);
    if (!owner) continue;
    const candidate = { owner, attachedAt: finiteAttachedAt(ref.attachedAt), index };
    if (!newest || compareThreadRefRecency(candidate, newest) > 0) newest = candidate;
  }

  return newest;
}

function compareThreadRefRecency(
  left: { attachedAt: number; index: number },
  right: { attachedAt: number; index: number },
): number {
  if (left.attachedAt !== right.attachedAt) return left.attachedAt - right.attachedAt;
  return left.index - right.index;
}

function finiteAttachedAt(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

function ownerFromRoute(threadKey: string | undefined, questId: string | undefined): AuthoritativeMessageOwner | null {
  const target =
    (threadKey ? normalizeThreadTarget(threadKey) : null) ?? (questId ? normalizeThreadTarget(questId) : null);
  if (!target) return null;
  return {
    threadKey: target.threadKey,
    ...(target.questId ? { questId: target.questId } : {}),
  };
}
