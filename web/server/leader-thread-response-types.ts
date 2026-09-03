import type { LeaderThreadTextRole } from "../shared/thread-routing.js";
import type { ParsedThreadStatusMarker } from "../shared/thread-status-marker.js";

export const LEADER_THREAD_RESPONSE_VERSION = 1 as const;

/** Control metadata retained on ordinary routed leader assistant rows until turn settlement. */
export type LeaderRoutedAssistantMetadata = {
  leaderThreadRole?: LeaderThreadTextRole;
  leaderResponseObservedHistoryLength?: number;
  deferredThreadStatusMarkers?: ParsedThreadStatusMarker[];
  threadResponse?: LeaderThreadResponseRevisionMetadata;
};

/** Read-only compatibility shape for dedicated response rows persisted before routed finals. */
export interface LegacyLeaderThreadResponseMessage<Notification, ThreadReference, RoutingError> {
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

/** Browser-only exact pending batch projection used for fail-closed presentation support. */
export interface LeaderThreadPendingBatchProjection {
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
