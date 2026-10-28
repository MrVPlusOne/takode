import { isTopicViewKey } from "../shared/topic-thread-key.js";
import {
  leaderResponseAnswerOwnerThreadKeys,
  leaderResponseProvenCurrentOwnerThreadKey,
} from "../shared/leader-thread-response-routing.js";
import type { BrowserIncomingMessage, ThreadAttachmentMarker, ThreadRef } from "./session-types.js";
import { buildLeaderThreadResponseState, type LeaderThreadResponseSession } from "./leader-thread-response.js";
import {
  buildLeaderUserMessageIdentities,
  isCanonicalLeaderUserMessageId,
  type LeaderUserMessageIdentity,
} from "./leader-user-message-id.js";

/**
 * Select exact committed, pending requests of one thread (Main or a topic's own thread) for a
 * handoff to a quest, or of Main for a handoff to a topic's thread, without changing history or
 * answer coverage. Proven same-leader handoff retries are returned separately, including after the
 * destination has answered them.
 */
export function prepareLeaderThreadHandoff(
  session: LeaderThreadResponseSession,
  destination: string,
  userMessageIds: readonly string[],
):
  | {
      ok: true;
      requests: LeaderUserMessageIdentity[];
      alreadyHandedOffUserMessageIds: string[];
      /** The thread the requests are handed off from. */
      sourceThreadKey: string;
    }
  | { ok: false; error: string } {
  const toQuest = /^q-\d+$/.test(destination);
  if (!toQuest && !isTopicViewKey(destination)) {
    return { ok: false, error: "The destination must be a quest (q-N) or a topic thread (topic:<handle>)" };
  }
  if (userMessageIds.length === 0 || userMessageIds.some((id) => !isCanonicalLeaderUserMessageId(id))) {
    return { ok: false, error: "Provide exact user-message IDs such as u1" };
  }
  if (new Set(userMessageIds).size !== userMessageIds.length) {
    return { ok: false, error: "User-message IDs must not repeat" };
  }

  const identities = new Map(
    buildLeaderUserMessageIdentities(session.messageHistory).map((entry) => [entry.userMessageId, entry]),
  );
  const pendingByThread = new Map<string, Set<string>>();
  const pendingIn = (threadKey: string) => {
    let pending = pendingByThread.get(threadKey);
    if (!pending) {
      pending = new Set(
        buildLeaderThreadResponseState(session, threadKey).projection.pendingMessages.map(
          (entry) => entry.userMessageId,
        ),
      );
      pendingByThread.set(threadKey, pending);
    }
    return pending;
  };
  const requests: LeaderUserMessageIdentity[] = [];
  const alreadyHandedOffUserMessageIds: string[] = [];
  let sourceThreadKey: string | null = null;
  for (const userMessageId of userMessageIds) {
    const request = identities.get(userMessageId);
    if (!request) {
      return { ok: false, error: `${userMessageId} is not a committed direct user request` };
    }
    const owner = leaderResponseProvenCurrentOwnerThreadKey(request.message);
    if (owner === destination && isSameLeaderHandoff(request, session.id, destination)) {
      alreadyHandedOffUserMessageIds.push(userMessageId);
      continue;
    }
    // A quest takes requests from Main or a topic's thread; a topic's thread takes them from Main.
    const fromAllowed = owner === "main" || (toQuest && !!owner && isTopicViewKey(owner));
    if (!owner || !fromAllowed || !pendingIn(owner).has(userMessageId)) {
      return {
        ok: false,
        error: toQuest
          ? `${userMessageId} must be an unanswered request currently owned by Main or a topic thread`
          : `${userMessageId} must be an unanswered request currently owned by Main`,
      };
    }
    if (sourceThreadKey && sourceThreadKey !== owner) {
      return { ok: false, error: "Hand off requests of one thread at a time" };
    }
    sourceThreadKey = owner;
    requests.push(request);
  }
  return { ok: true, requests, alreadyHandedOffUserMessageIds, sourceThreadKey: sourceThreadKey ?? "main" };
}

/** The ownership ref a handoff appends to each transferred request. */
export function handoffThreadRef(threadKey: string, attachedAt: number, attachedBy: string): ThreadRef {
  return {
    threadKey,
    ...(/^q-\d+$/.test(threadKey) ? { questId: threadKey } : {}),
    source: "explicit",
    attachedAt,
    attachedBy,
  };
}

/**
 * Re-apply handoff refs missing from restored requests. Servers before the
 * frozen-edit fix kept a handoff of an already-frozen request only in memory,
 * so a restart returned it to Main and invalidated its quest answer. The
 * appended handoff marker still records the exact transfer, so restore derives
 * the same ref from it. A request answered after the loss keeps the owner its
 * answer sealed: restoring the ref would invalidate that answer instead.
 * Returns the number of refs restored.
 */
export function restoreUnpersistedHandoffRefs(history: BrowserIncomingMessage[]): number {
  const markers = history.filter(
    (entry): entry is ThreadAttachmentMarker =>
      entry.type === "thread_attachment_marker" && entry.markerKey.startsWith("handoff:") && !!entry.threadKey,
  );
  if (markers.length === 0) return 0;
  const userMessageIds = new Map(
    buildLeaderUserMessageIdentities(history).map((entry) => [entry.historyIndex, entry.userMessageId]),
  );
  const sealedOwners = sealedAnswerOwners(history);
  let restored = 0;
  for (const marker of markers) {
    const ref = handoffThreadRef(marker.questId ?? marker.threadKey, marker.attachedAt, marker.attachedBy);
    marker.messageIndices.forEach((index, position) => {
      const request = history[index];
      // Notification anchors share the marker; only requests carry ownership.
      if (request?.type !== "user_message" || request.id !== marker.messageIds[position]) return;
      const owners = sealedOwners.get(userMessageIds.get(index) ?? "");
      if (owners && [...owners].some((owner) => owner !== ref.threadKey)) return;
      const present = (request.threadRefs ?? []).some(
        (existing) =>
          existing.source === "explicit" &&
          existing.threadKey === ref.threadKey &&
          existing.attachedAt === ref.attachedAt,
      );
      if (present) return;
      request.threadRefs = [...(request.threadRefs ?? []), ref];
      restored += 1;
    });
  }
  return restored;
}

/** Owners recorded per request by settled explicit answers. */
function sealedAnswerOwners(history: readonly BrowserIncomingMessage[]): Map<string, Set<string>> {
  const owners = new Map<string, Set<string>>();
  for (const message of history) {
    if (message.type !== "assistant" || !message.threadAnswer) continue;
    const source = message.threadAnswer.authoredThreadKey ?? message.threadKey ?? "main";
    for (const [userMessageId, owner] of leaderResponseAnswerOwnerThreadKeys(message.threadAnswer, source) ?? []) {
      owners.set(userMessageId, (owners.get(userMessageId) ?? new Set()).add(owner));
    }
  }
  return owners;
}

function isSameLeaderHandoff(request: LeaderUserMessageIdentity, sessionId: string, destination: string): boolean {
  const { threadKey, questId: originalQuestId, threadRefs } = request.message;
  const original = leaderResponseProvenCurrentOwnerThreadKey({ threadKey, questId: originalQuestId });
  if (original !== "main" && !(original && isTopicViewKey(original))) return false;
  return (threadRefs ?? []).some(
    (ref) =>
      ref.source === "explicit" &&
      ref.threadKey === destination &&
      (!/^q-\d+$/.test(destination) || ref.questId === destination) &&
      ref.attachedBy === sessionId &&
      typeof ref.attachedAt === "number" &&
      Number.isFinite(ref.attachedAt),
  );
}
