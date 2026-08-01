export type SessionParticipantRelation = { reviewerOf?: number; herdedBy?: string };

export type SessionLifecycleBrowserMessage =
  | ({ type: "session_deleted"; session_id: string } & SessionParticipantRelation)
  | { type: "session_created"; session_id: string }
  | ({ type: "session_archived"; session_id: string; archivedAt?: number } & SessionParticipantRelation);
