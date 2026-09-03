export const LEADER_THREAD_RESPONSE_VERSION = 1 as const;

export interface LeaderThreadResponseMessage<Notification, ThreadReference, RoutingError> {
  type: "leader_user_message";
  content: string;
  timestamp: number;
  id: string;
  notification?: Notification;
  threadKey?: string;
  questId?: string;
  threadRefs?: ThreadReference[];
  threadRoutingError?: RoutingError;
  threadResponse?: LeaderThreadResponseRevisionMetadata;
}

/** Immutable audit metadata stored on each append-only leader response revision message. */
export interface LeaderThreadResponseRevisionMetadata {
  logicalResponseId: string;
  revisionId: string;
  parentRevisionId?: string;
  revisionNumber: number;
  batchId: string;
  batchObservedHistoryLength: number;
  coveredUserMessageIds: string[];
  contentHash: string;
  idempotencyKey?: string;
  idempotencyHash?: string;
}

export interface LeaderThreadResponseRevision {
  revisionId: string;
  parentRevisionId?: string;
  revisionNumber: number;
  messageId: string;
  historyIndex: number;
  markdown: string;
  batchId: string;
  batchObservedHistoryLength: number;
  coveredUserMessageIds: string[];
  contentHash: string;
  createdAt: number;
  idempotencyKey?: string;
}

/** Compact current pointer for one logical response to one server-defined pending batch. */
export interface LeaderThreadResponseState {
  version: typeof LEADER_THREAD_RESPONSE_VERSION;
  logicalResponseId: string;
  threadKey: string;
  questId?: string;
  batchId: string;
  batchObservedHistoryLength: number;
  coveredUserMessageIds: string[];
  currentRevisionId: string;
  currentMessageId: string;
  currentHistoryIndex: number;
  revisionCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface LeaderThreadResponseDetail extends LeaderThreadResponseState {
  revisions: LeaderThreadResponseRevision[];
}

export interface LeaderThreadPendingBatchMemberPreview {
  timestamp: number;
  preview: string;
  truncated: boolean;
  imageCount: number;
}

/** Browser-only exact pending batch projection; tokens replace message IDs in normal leader authoring APIs. */
export interface LeaderThreadPendingBatchProjection {
  token: string;
  userMessageIds: string[];
  messageCount: number;
  firstHistoryIndex: number;
  lastHistoryIndex: number;
  firstAskedAt: number;
  lastAskedAt: number;
}

export interface LeaderThreadResponseProjection {
  version: typeof LEADER_THREAD_RESPONSE_VERSION;
  threadKey: string;
  cutoverHistoryIndex: number;
  pendingMessageCount: number;
  pendingBatches: LeaderThreadPendingBatchProjection[];
  currentResponses: LeaderThreadResponseState[];
  ready: boolean;
}
