import { buildProjectionAttentionRecords, collectMessageAttentionRecords } from "../../shared/leader-projection.js";
import type { ChatMessage, SessionAttentionRecord, SessionNotification } from "../types.js";
import { ALL_THREADS_KEY, MAIN_THREAD_KEY, normalizeThreadKey } from "./thread-projection.js";

export type AttentionRecord = SessionAttentionRecord;

export interface AttentionBoardRowSource {
  questId: string;
  title?: string;
  status?: string;
  waitFor?: string[];
  waitForInput?: string[];
  createdAt?: number;
  updatedAt: number;
  completedAt?: number;
}

export interface BuildAttentionRecordsInput {
  leaderSessionId: string;
  records?: ReadonlyArray<AttentionRecord>;
  notifications?: ReadonlyArray<SessionNotification>;
  boardRows?: ReadonlyArray<AttentionBoardRowSource>;
  completedBoardRows?: ReadonlyArray<AttentionBoardRowSource>;
  messages?: ReadonlyArray<ChatMessage>;
}

export interface BuildAttentionLedgerMessagesOptions {
  availableMessageIds?: ReadonlySet<string>;
  windowedMainFeed?: boolean;
  mainWindowFromTimestamp?: number;
  mainWindowToTimestamp?: number;
}

const ACTIVE_ATTENTION_STATES = new Set<AttentionRecord["state"]>(["unresolved", "seen", "reopened"]);
const PRIORITY_ORDER = new Map<AttentionRecord["priority"], number>([
  ["needs_input", 0],
  ["review", 1],
  ["blocked", 2],
  ["created", 3],
  ["milestone", 4],
  ["completed", 5],
]);

function isJourneyLifecycleFeedRecord(record: Pick<AttentionRecord, "type">): boolean {
  return record.type === "quest_journey_started" || record.type === "quest_completed_recent";
}

export function buildAttentionRecords(input: BuildAttentionRecordsInput): AttentionRecord[] {
  const messageRecords = collectMessageAttentionRecords(input.leaderSessionId, input.messages ?? []);
  return buildProjectionAttentionRecords({
    leaderSessionId: input.leaderSessionId,
    records: [...(input.records ?? []), ...messageRecords],
    notifications: input.notifications,
    boardRows: input.boardRows,
    completedBoardRows: input.completedBoardRows,
  });
}

export function selectMainLedgerRecords(
  records: ReadonlyArray<AttentionRecord>,
  options: Pick<
    BuildAttentionLedgerMessagesOptions,
    "availableMessageIds" | "windowedMainFeed" | "mainWindowFromTimestamp" | "mainWindowToTimestamp"
  > = {},
): AttentionRecord[] {
  const selected = records
    .filter(
      (record) =>
        record.ledgerEligible &&
        !isJourneyLifecycleFeedRecord(record) &&
        record.type !== "quest_thread_created" &&
        !isThreadReadyReviewRecord(record) &&
        !isRedundantActiveNotification(record, options.availableMessageIds),
    )
    .sort(compareAttentionRecordsChronologically);
  if (!options.windowedMainFeed) return selected;
  const fromTimestamp = options.mainWindowFromTimestamp;
  const toTimestamp = options.mainWindowToTimestamp;
  if (fromTimestamp === undefined || toTimestamp === undefined) return [];

  return selected.filter((record) => record.createdAt >= fromTimestamp && record.createdAt <= toTimestamp);
}

export function selectAttentionChipRecords(records: ReadonlyArray<AttentionRecord>): AttentionRecord[] {
  return records
    .filter((record) => record.chipEligible && isAttentionRecordActive(record))
    .sort(compareAttentionRecordsByPriority);
}

export function isAttentionRecordActive(record: Pick<AttentionRecord, "state">): boolean {
  return ACTIVE_ATTENTION_STATES.has(record.state);
}

export function isNeedsInputNotificationTabCandidate(record: AttentionRecord): boolean {
  return (
    record.source.kind === "notification" &&
    record.type === "needs_input" &&
    record.priority === "needs_input" &&
    isAttentionRecordActive(record)
  );
}

function isRedundantActiveNotification(record: AttentionRecord, availableMessageIds?: ReadonlySet<string>): boolean {
  if (record.source.kind !== "notification" || !isAttentionRecordActive(record)) return false;
  if (record.priority === "needs_input" && record.type === "needs_input") return true;

  const anchoredMessageId = record.route.messageId || record.source.messageId || null;
  return !!anchoredMessageId && availableMessageIds?.has(anchoredMessageId) === true;
}

export function isAttentionLedgerMessage(message: ChatMessage): boolean {
  return !!message.metadata?.attentionRecord;
}

export function buildAttentionLedgerMessages(
  records: ReadonlyArray<AttentionRecord>,
  threadKey: string = MAIN_THREAD_KEY,
  options: BuildAttentionLedgerMessagesOptions = {},
): ChatMessage[] {
  return selectLedgerRecordsForThread(records, threadKey, options).map(attentionRecordToMessage);
}

function selectLedgerRecordsForThread(
  records: ReadonlyArray<AttentionRecord>,
  threadKey: string,
  options: BuildAttentionLedgerMessagesOptions,
): AttentionRecord[] {
  const normalized = normalizeThreadKey(threadKey);
  if (normalized === MAIN_THREAD_KEY) return selectMainLedgerRecords(records, options);
  if (normalized === ALL_THREADS_KEY) return [];

  return records
    .filter((record) => shouldRenderOwnerThreadLedgerRecord(record, normalized, options.availableMessageIds))
    .sort(compareAttentionRecordsChronologically);
}

function shouldRenderOwnerThreadLedgerRecord(
  record: AttentionRecord,
  threadKey: string,
  availableMessageIds?: ReadonlySet<string>,
): boolean {
  return shouldRenderOwnerThreadNotificationRecord(record, threadKey, availableMessageIds);
}

function shouldRenderOwnerThreadNotificationRecord(
  record: AttentionRecord,
  threadKey: string,
  availableMessageIds?: ReadonlySet<string>,
): boolean {
  if (!record.ledgerEligible) return false;
  if (isThreadReadyReviewRecord(record)) return false;
  if (record.source.kind !== "notification") return false;
  if (record.type !== "needs_input" || record.priority !== "needs_input") return false;
  if (!isAttentionRecordActive(record)) return false;

  const targetThreadKey = normalizeThreadKey(record.route.threadKey || record.threadKey);
  if (targetThreadKey !== threadKey) return false;

  const anchoredMessageId = record.route.messageId || record.source.messageId || null;
  return !anchoredMessageId || !availableMessageIds?.has(anchoredMessageId);
}

function isThreadReadyReviewRecord(record: AttentionRecord): boolean {
  if (record.type !== "review_ready" || record.source.kind !== "notification") return false;
  return /^thread ready\s*:/i.test(record.title.trim()) || /^thread ready\s*:/i.test(record.summary.trim());
}

export function mergeChronologicalMessages(messages: ChatMessage[], insertedMessages: ChatMessage[]): ChatMessage[] {
  if (insertedMessages.length === 0) return messages;
  if (messages.length === 0) return insertedMessages;
  const merged = [...messages];
  const sortedInsertedMessages = [...insertedMessages].sort(compareByTimestamp);
  for (const insertedMessage of sortedInsertedMessages) {
    const insertIndex = merged.findIndex((message) => compareByTimestamp(insertedMessage, message) < 0);
    if (insertIndex < 0) {
      merged.push(insertedMessage);
      continue;
    }
    merged.splice(insertIndex, 0, insertedMessage);
  }
  return merged;
}

function compareByTimestamp(
  a: Pick<ChatMessage, "id" | "timestamp">,
  b: Pick<ChatMessage, "id" | "timestamp">,
): number {
  const timeDelta = a.timestamp - b.timestamp;
  if (timeDelta !== 0) return timeDelta;
  return a.id.localeCompare(b.id);
}

export function parseQuestIdsFromReviewSummary(summary: string | undefined): string[] {
  const match = summary?.match(/^\s*\d+\s+quests?\s+(?:ready\s+for\s+review|finished)\s*:\s*(.+?)\s*$/i);
  if (!match) return [];
  return [...match[1].matchAll(/\bq-\d+\b/gi)].map((questIdMatch) => questIdMatch[0].toLowerCase());
}

function attentionRecordToMessage(record: AttentionRecord): ChatMessage {
  return {
    id: attentionLedgerMessageIdForRecord(record),
    role: "system",
    content: `${record.actionLabel}: ${record.title}`,
    timestamp: record.createdAt,
    variant: "info",
    ephemeral: true,
    metadata: {
      threadKey: MAIN_THREAD_KEY,
      attentionRecord: record,
    },
  };
}

export function attentionLedgerMessageIdForRecord(record: Pick<AttentionRecord, "id">): string {
  return `attention-ledger:${record.id}`;
}

export function attentionLedgerMessageIdForNotificationId(notificationId: string): string {
  return `attention-ledger:notification:${notificationId}`;
}

function compareAttentionRecordsChronologically(a: AttentionRecord, b: AttentionRecord): number {
  const timeDelta = a.createdAt - b.createdAt;
  if (timeDelta !== 0) return timeDelta;
  return a.id.localeCompare(b.id);
}

function compareAttentionRecordsByPriority(a: AttentionRecord, b: AttentionRecord): number {
  const priorityDelta = (PRIORITY_ORDER.get(a.priority) ?? 99) - (PRIORITY_ORDER.get(b.priority) ?? 99);
  if (priorityDelta !== 0) return priorityDelta;
  const recencyDelta = b.updatedAt - a.updatedAt;
  if (recencyDelta !== 0) return recencyDelta;
  return a.id.localeCompare(b.id);
}
