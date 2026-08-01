import type { SessionLifecycleBrowserMessage, SessionParticipantRelation } from "../session-lifecycle-message.js";

type GlobalLifecycleBroadcaster = {
  broadcastGlobal: (message: SessionLifecycleBrowserMessage) => void;
  closeSession: (sessionId: string) => void;
};

function relationFields(relation?: SessionParticipantRelation) {
  return {
    ...(relation?.reviewerOf !== undefined ? { reviewerOf: relation.reviewerOf } : {}),
    ...(relation?.herdedBy ? { herdedBy: relation.herdedBy } : {}),
  };
}

export function broadcastSessionArchived(
  bridge: GlobalLifecycleBroadcaster,
  sessionId: string,
  archivedAt: number | undefined,
  relation?: SessionParticipantRelation,
): void {
  bridge.broadcastGlobal({
    type: "session_archived",
    session_id: sessionId,
    archivedAt,
    ...relationFields(relation),
  });
}

export function broadcastSessionDeletedAndClose(
  bridge: GlobalLifecycleBroadcaster,
  sessionId: string,
  relation?: SessionParticipantRelation,
): void {
  bridge.broadcastGlobal({ type: "session_deleted", session_id: sessionId, ...relationFields(relation) });
  bridge.closeSession(sessionId);
}
