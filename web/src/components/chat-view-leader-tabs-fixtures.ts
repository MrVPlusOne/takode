import type { SessionNotification, ThreadTransitionMarker } from "../types.js";

export function projectionTabKeys(keys: string[]) {
  return keys;
}

export function leaderSession() {
  return new Map([
    [
      "s1",
      {
        backend_state: "connected" as const,
        backend_error: null,
        isOrchestrator: true,
      },
    ],
  ]);
}

export function threadMessage(questId: string, timestamp: number) {
  return {
    id: `m-${questId}`,
    role: "assistant",
    content: `${questId} update`,
    timestamp,
    metadata: { threadRefs: [{ threadKey: questId, questId, source: "explicit" }] },
  };
}

export function needsInputNotification(questId: string, timestamp: number): SessionNotification {
  return {
    id: `n-${questId}`,
    category: "needs-input",
    summary: `${questId} needs input`,
    suggestedAnswers: [],
    questions: [],
    timestamp,
    messageId: null,
    threadKey: questId,
    questId,
    done: false,
  };
}

export function movedUser(questId: string, attachedAt: number, historyIndex = 1) {
  return {
    id: `u-${questId}`,
    role: "user",
    content: "Please make this a quest.",
    timestamp: attachedAt - 2,
    historyIndex,
    metadata: { threadRefs: [{ threadKey: questId, questId, source: "backfill" }] },
  };
}

export function movedMarker(
  questId: string,
  attachedAt: number,
  source?: { sourceThreadKey?: string; sourceQuestId?: string },
) {
  return {
    id: `marker-${questId}`,
    role: "system",
    content: `1 message moved to ${questId}`,
    timestamp: attachedAt,
    historyIndex: 2,
    metadata: {
      threadAttachmentMarker: {
        type: "thread_attachment_marker",
        id: `marker-${questId}`,
        timestamp: attachedAt,
        markerKey: `thread-attachment:${questId}:u-${questId}`,
        threadKey: questId,
        questId,
        ...source,
        attachedAt,
        attachedBy: "leader",
        messageIds: [`u-${questId}`],
        messageIndices: [1],
        ranges: ["1"],
        count: 1,
        firstMessageId: `u-${questId}`,
        firstMessageIndex: 1,
      },
    },
  };
}

export function transitionMarker(
  questId: string,
  transitionedAt: number,
  overrides: Partial<ThreadTransitionMarker> = {},
) {
  return {
    id: "transition-" + questId,
    role: "system",
    content: "Work continued from Main to thread:" + questId,
    timestamp: transitionedAt,
    historyIndex: 2,
    metadata: {
      threadTransitionMarker: {
        type: "thread_transition_marker",
        id: "transition-" + questId,
        timestamp: transitionedAt,
        markerKey: "thread-transition:main->" + questId + ":1",
        sourceThreadKey: "main",
        threadKey: questId,
        questId,
        transitionedAt,
        reason: "route_switch",
        sourceMessageIndex: 1,
        targetThreadFreshness: "new_quest_thread",
        ...overrides,
      },
    },
  };
}
