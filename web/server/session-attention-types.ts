/**
 * The attention records and notifications a session collects for the user (questions, results,
 * quest milestones), kept apart from `session-types.ts` and re-exported there.
 */
import type {
  NeedsInputNotificationQuestion,
  NotificationCategory,
  ThreadAttachmentMovementSummary,
  ThreadRef,
} from "./session-types.js";

export type NotificationUrgency = "needs-input" | "review" | null;

export type SessionAttentionRecordType =
  | "needs_input"
  | "review_ready"
  | "blocked_user_resolvable"
  | "quest_journey_started"
  | "quest_thread_created"
  | "quest_completed_recent"
  | "quest_reopened_or_rework"
  | "attention_summary";

export type SessionAttentionRecordPriority =
  | "needs_input"
  | "review"
  | "blocked"
  | "created"
  | "completed"
  | "milestone";

export type SessionAttentionRecordState =
  | "unresolved"
  | "muted"
  | "seen"
  | "resolved"
  | "dismissed"
  | "reopened"
  | "superseded";

export interface SessionAttentionRecordRoute {
  threadKey: string;
  questId?: string;
  messageId?: string;
  messageIndex?: number;
  bannerId?: string;
  questOverlay?: string;
}

export interface SessionAttentionRecord {
  id: string;
  leaderSessionId: string;
  type: SessionAttentionRecordType;
  source: {
    kind: "notification" | "board" | "quest" | "herd" | "message" | "manual";
    id?: string;
    questId?: string;
    messageId?: string | null;
    signature?: string;
  };
  questId?: string;
  threadKey: string;
  title: string;
  summary: string;
  /** Optional quest description TLDR used by quest lifecycle presentation rows. */
  questTldr?: string;
  actionLabel: "Answer" | "Review" | "Unblock" | "Open" | "Jump";
  priority: SessionAttentionRecordPriority;
  state: SessionAttentionRecordState;
  journeyLifecycleStatus?: "active" | "completed";
  createdAt: number;
  updatedAt: number;
  resolvedAt?: number;
  dismissedAt?: number;
  reopenedAt?: number;
  route: SessionAttentionRecordRoute;
  chipEligible: boolean;
  ledgerEligible: boolean;
  dedupeKey: string;
  supersedesDedupeKeys?: string[];
  threadAttachmentSummary?: ThreadAttachmentMovementSummary;
}

/** A notification collected when `takode notify` fires. Persisted per session. */
export interface SessionNotification {
  id: string;
  category: NotificationCategory;
  summary?: string;
  /** Legacy decision context rendered inside the card. Only prompts created before question-only cards have it. */
  body?: string;
  /**
   * Question-only prompt: cards, phone alerts and attention panels show only the question. Any decision
   * context is the anchored feed message (`contextMessageId`), rendered as ordinary assistant text.
   */
  questionOnly?: boolean;
  /** History message holding this prompt's decision context; equals `messageId` when present. */
  contextMessageId?: string;
  suggestedAnswers?: string[];
  questions?: NeedsInputNotificationQuestion[];
  timestamp: number;
  /** Assistant message ID for jump-to-message links (null if no message was anchored) */
  messageId: string | null;
  /** Thread route for same-thread prompt matching. Main is explicit for new notifications. */
  threadKey?: string;
  questId?: string;
  threadRefs?: ThreadRef[];
  done: boolean;
  /**
   * Why Takode itself made a leader thread unread: a newly settled answer, a published report
   * or a completed quest.
   * Absent on notifications an agent sent, and on older Thread Ready unread records.
   */
  unreadReason?: "answer" | "quest-complete" | "report";
  /**
   * For an answer: the user's requests (uN) it answers. Answers to the same request count as one
   * new item in attention counts.
   */
  answerTo?: string[];
  /** An answer the leader marked urgent: it sorts near the top of the attention list. */
  urgent?: true;
  /** When the notification was last marked done (answered, read or dismissed); absent while open. */
  doneAt?: number;
  /**
   * When the user last marked it done from a browser (read it, or dismissed or answered a
   * question), unlike Takode or an agent resolving it: the user dealing with its thread.
   */
  userDoneAt?: number;
  /** Muted unresolved needs-input prompts stay answerable but leave active attention counts. */
  muted?: boolean;
  mutedAt?: number;
  /** Snoozed prompts are muted until this time, then return as a fresh alert ("remind me later"). */
  snoozedUntil?: number;
  resolutionNotice?: {
    status: "pending" | "queued" | "delivered";
    source: "manual" | "response";
    resolvedAt: number;
    queuedInputId?: string;
    deliveredAt?: number;
  };
  /** Turn-end herd label recorded when this needs-input pause was surfaced. */
  herdDecisionWaitReportedAt?: number;
  /** Turn-end herd label recorded when the first later same-route external turn completed. */
  herdDecisionResumeReportedAt?: number;
}
