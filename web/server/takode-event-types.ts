import type { NeedsInputNotificationQuestion } from "./session-types.js";

// ─── Takode Orchestration Events ─────────────────────────────────────────────

export type TakodeEventType =
  | "turn_end"
  | "worker_stream"
  | "turn_start"
  | "compaction_started"
  | "compaction_finished"
  | "permission_request"
  | "permission_resolved"
  | "herd_reassigned"
  | "session_disconnected"
  | "session_error"
  | "session_archived"
  | "session_deleted"
  | "user_message"
  | "board_stalled"
  | "board_dispatchable"
  | "notification_needs_input"
  | "message_delivery";

export interface TakodeTurnEndMsgRange {
  from: number;
  to: number;
}

export interface TakodeTurnEndQuestChange {
  questId: string;
  from: string;
  to: string;
}

export interface TakodeTurnEndUserMessages {
  count: number;
  ids: number[];
}

export interface TakodeTurnStartEventData {
  reason?: string;
  userMessage?: string;
}

export interface TakodeTurnEndEventData {
  reason?: string;
  duration_ms: number;
  is_error?: boolean;
  interrupted?: boolean;
  interrupt_source?: "user" | "leader" | "system";
  /** True when an interruption-style event is an early recovery signal and the backend may still finish. */
  recovery_pending?: boolean;
  /** True when the event is informational/provisional rather than a final turn outcome. */
  provisional?: boolean;
  interrupt_origin?: "restart_prep";
  restart_prep_operation_id?: string;
  compacted?: boolean;
  /** The turn ended after creating a still-unresolved needs-input decision. */
  awaiting_decision?: boolean;
  /** The turn was driven by a reply to a needs-input decision. */
  resumed_after_decision?: boolean;
  tools?: Record<string, number>;
  resultPreview?: string;
  msgRange?: TakodeTurnEndMsgRange;
  questChange?: TakodeTurnEndQuestChange;
  userMsgs?: TakodeTurnEndUserMessages;
  /** Who triggered this turn: "user" (direct chat), "leader" (orchestrator),
   *  "system" (internal injection), or "unknown" (no user message tracked). */
  turn_source?: "user" | "leader" | "system" | "unknown";
  /** Explicit route for the user message that drove this turn, when known. */
  threadKey?: string;
  questId?: string;
  phaseNote?: {
    phaseId?: string;
    index?: number;
    tldr?: string;
  };
}

export interface TakodeWorkerStreamEventData
  extends Pick<
    TakodeTurnEndEventData,
    | "duration_ms"
    | "tools"
    | "resultPreview"
    | "msgRange"
    | "questChange"
    | "userMsgs"
    | "turn_source"
    | "threadKey"
    | "questId"
    | "phaseNote"
  > {
  reason?: "checkpoint" | "report";
  report?: import("../shared/worker-report.js").WorkerReportReference;
}

export interface TakodeCompactionEventData {
  context_used_percent?: number;
}

export interface TakodePermissionRequestEventData {
  tool_name: string;
  request_id?: string;
  summary?: string;
  question?: string;
  options?: string[];
  /** Full plan text for ExitPlanMode -- included in herd events so leaders can review inline. */
  planContent?: string;
  /** Who triggered the turn containing this permission request. */
  turn_source?: "user" | "leader" | "system" | "unknown";
  /** Index of the last assistant message in messageHistory when the permission was emitted. */
  msg_index?: number;
  threadKey?: string;
  questId?: string;
}

export interface TakodePermissionResolvedEventData {
  tool_name: string;
  outcome: "approved" | "denied";
}

export interface TakodeHerdReassignedEventData {
  fromLeaderSessionId: string;
  fromLeaderLabel: string;
  toLeaderSessionId: string;
  toLeaderLabel: string;
  reviewerCount?: number;
}

export interface TakodeSessionDisconnectedEventData {
  wasGenerating: boolean;
  reason: string;
}

export interface TakodeSessionErrorEventData {
  error: string;
}

export interface TakodeSessionArchivedEventData {
  /** Who initiated the archive flow: direct user action, a leader action, or automatic cascade. */
  archive_source?: "user" | "leader" | "cascade" | "system" | "unknown";
}

export type TakodeSessionLifecycleEventData = Record<string, never>;

export interface TakodeUserMessageEventData {
  content: string;
  /** Index in session.messageHistory for exact takode read/peek lookup. */
  msg_index?: number;
  /** Stable message id when present on the stored user_message entry. */
  message_id?: string;
  /** Current vs queued turn target for the user dispatch, when known. */
  turn_target?: "current" | "queued" | null;
  /** Codex turn id when the message is associated with an active Codex turn. */
  turn_id?: string | null;
  agentSource?: {
    sessionId: string;
    sessionLabel?: string;
  };
  threadKey?: string;
  questId?: string;
}

export interface TakodeNotificationNeedsInputEventData {
  summary?: string;
  /** Decision context the worker supplied with the prompt. */
  context?: string;
  suggestedAnswers?: string[];
  questions?: NeedsInputNotificationQuestion[];
  notificationId?: string;
  messageId?: string | null;
  msg_index?: number;
  threadKey?: string;
  questId?: string;
}

export interface TakodeBoardStalledEventData {
  questId: string;
  title?: string;
  stage?: string;
  /** Internal stability key used to drop stale queued stall warnings. */
  signature?: string;
  /** Start of this distinct stall occurrence; a recovered row may later stall again with the same status. */
  stalledSince?: number;
  workerStatus?: "running" | "idle" | "disconnected" | "missing";
  reviewerStatus?: "running" | "idle" | "disconnected" | "missing";
  stalledForMs: number;
  reason: string;
  action?: string;
}

export interface TakodeBoardDispatchableEventData {
  questId: string;
  title?: string;
  /** Internal stability key used to drop stale queued dispatchable warnings. */
  signature?: string;
  /** Board row updatedAt value when the dispatchable transition was observed. */
  rowUpdatedAt?: number;
  summary: string;
  action?: string;
}

/** Outcome of a message the leader sent while the target was not running (see message-delivery-tracker.ts). */
export interface TakodeMessageDeliveryEventData {
  messageId: string;
  status: "delivered" | "failed";
  reason?: string;
  preview: string;
  queuedAt: number;
  questId?: string;
}

export interface TakodeHerdBatchSnapshot {
  events: TakodeEvent[];
  renderedLines: string[];
  eventKeys?: string[];
}

export interface TakodeHerdEventBrowserMetadata {
  event: TakodeEventType;
  sessionId: string;
  sessionNum: number;
  ts: number;
  routine: boolean;
  lifecycle?: import("../shared/herd-event-lifecycle.js").TakodeHerdEventLifecycle[];
}

export interface TakodeEventDataByType {
  turn_end: TakodeTurnEndEventData;
  worker_stream: TakodeWorkerStreamEventData;
  turn_start: TakodeTurnStartEventData;
  compaction_started: TakodeCompactionEventData;
  compaction_finished: TakodeCompactionEventData;
  permission_request: TakodePermissionRequestEventData;
  permission_resolved: TakodePermissionResolvedEventData;
  herd_reassigned: TakodeHerdReassignedEventData;
  session_disconnected: TakodeSessionDisconnectedEventData;
  session_error: TakodeSessionErrorEventData;
  session_archived: TakodeSessionArchivedEventData;
  session_deleted: TakodeSessionLifecycleEventData;
  user_message: TakodeUserMessageEventData;
  board_stalled: TakodeBoardStalledEventData;
  board_dispatchable: TakodeBoardDispatchableEventData;
  notification_needs_input: TakodeNotificationNeedsInputEventData;
  message_delivery: TakodeMessageDeliveryEventData;
}

interface TakodeEventBase {
  /** Monotonic event ID for cursor-based catchup */
  id: number;
  /** Full session UUID */
  sessionId: string;
  /** Short integer session ID */
  sessionNum: number;
  /** Human-readable session name */
  sessionName: string;
  /** Epoch ms timestamp */
  ts: number;
  /** Session that triggered this event (e.g. leader who ran archive/answer).
   *  The herd event dispatcher skips delivering events back to the actor. */
  actorSessionId?: string;
}

export type TakodeEvent = {
  [E in TakodeEventType]: TakodeEventBase & {
    /** Event type */
    event: E;
    /** Event-specific payload */
    data: TakodeEventDataByType[E];
  };
}[TakodeEventType];

export type TakodeEventFor<E extends TakodeEventType> = Extract<TakodeEvent, { event: E }>;

/** Subscriber handle for the takode event stream */
export interface TakodeEventSubscriber {
  /** Session UUIDs this subscriber cares about */
  sessions: Set<string>;
  /** Callback invoked for each matching event */
  callback: (event: TakodeEvent) => void;
}
