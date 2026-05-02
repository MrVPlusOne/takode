import type {
  ContentBlock,
  LeaderProjectionSnapshot,
  LeaderProjectionThreadSummary,
  ThreadAttachmentMarker,
  ThreadRef,
  ThreadTransitionMarker,
} from "../server/session-types.js";
import { parseCommandThreadComment, parseThreadTextPrefix } from "./thread-routing.js";

export interface LeaderThreadRouteIndexMessageLike {
  id?: string;
  type?: string;
  role?: string;
  content?: unknown;
  contentBlocks?: ContentBlock[];
  message?: unknown;
  timestamp?: number;
  threadKey?: string;
  questId?: string;
  threadRefs?: ThreadRef[];
  metadata?: {
    threadKey?: string;
    questId?: string;
    threadRefs?: ThreadRef[];
    threadAttachmentMarker?: ThreadAttachmentMarker;
    threadTransitionMarker?: ThreadTransitionMarker;
    quest?: { questId?: string };
  };
  historyIndex?: number;
}

export interface LeaderThreadRouteIndex {
  schemaVersion: 1;
  sourceHistoryLength: number;
  sourceFingerprint: string;
  sourceFingerprintHash: number;
  threadSummaries: LeaderProjectionThreadSummary[];
  rawTurnBoundaries: LeaderProjectionSnapshot["rawTurnBoundaries"];
  openTurnStartHistoryIndex: number | null;
}

interface LeaderThreadRouteIndexDraft {
  sourceHistoryLength: number;
  sourceFingerprintHash: number;
  summaries: Map<string, LeaderProjectionThreadSummary>;
  rawTurnBoundaries: LeaderProjectionSnapshot["rawTurnBoundaries"];
  openTurnStartHistoryIndex: number | null;
}

export const LEADER_THREAD_ROUTE_INDEX_SCHEMA_VERSION = 1;
export const MAIN_THREAD_KEY = "main";

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export function buildLeaderThreadRouteIndex(
  messages: ReadonlyArray<LeaderThreadRouteIndexMessageLike>,
): LeaderThreadRouteIndex {
  return finalizeDraft(appendMessagesToDraft(emptyDraft(), messages));
}

export function appendLeaderThreadRouteIndex(
  index: LeaderThreadRouteIndex,
  messages: ReadonlyArray<LeaderThreadRouteIndexMessageLike>,
): LeaderThreadRouteIndex {
  if (index.schemaVersion !== LEADER_THREAD_ROUTE_INDEX_SCHEMA_VERSION) {
    return buildLeaderThreadRouteIndex(messages);
  }
  return finalizeDraft(appendMessagesToDraft(draftFromIndex(index), messages));
}

export function leaderThreadRouteIndexMatchesSource(
  index: LeaderThreadRouteIndex | undefined,
  messages: ReadonlyArray<LeaderThreadRouteIndexMessageLike>,
): index is LeaderThreadRouteIndex {
  if (!index || index.schemaVersion !== LEADER_THREAD_ROUTE_INDEX_SCHEMA_VERSION) return false;
  if (index.sourceHistoryLength !== messages.length) return false;
  return index.sourceFingerprint === buildLeaderThreadRouteIndex(messages).sourceFingerprint;
}

export function collectLeaderThreadSummariesFromRouteIndex(
  index: LeaderThreadRouteIndex,
): LeaderProjectionThreadSummary[] {
  return index.threadSummaries.map((summary) => ({ ...summary }));
}

export function buildRawTurnBoundariesFromRouteIndex(
  index: LeaderThreadRouteIndex,
): LeaderProjectionSnapshot["rawTurnBoundaries"] {
  return index.rawTurnBoundaries.map((boundary) => ({ ...boundary }));
}

function emptyDraft(): LeaderThreadRouteIndexDraft {
  return {
    sourceHistoryLength: 0,
    sourceFingerprintHash: FNV_OFFSET_BASIS,
    summaries: new Map(),
    rawTurnBoundaries: [],
    openTurnStartHistoryIndex: null,
  };
}

function draftFromIndex(index: LeaderThreadRouteIndex): LeaderThreadRouteIndexDraft {
  const rawTurnBoundaries = index.rawTurnBoundaries.map((boundary) => ({ ...boundary }));
  if (
    index.openTurnStartHistoryIndex !== null &&
    rawTurnBoundaries.at(-1)?.endHistoryIndex === null &&
    rawTurnBoundaries.at(-1)?.startHistoryIndex === index.openTurnStartHistoryIndex
  ) {
    rawTurnBoundaries.pop();
  }
  return {
    sourceHistoryLength: index.sourceHistoryLength,
    sourceFingerprintHash: index.sourceFingerprintHash,
    summaries: new Map(index.threadSummaries.map((summary) => [summary.threadKey, { ...summary }])),
    rawTurnBoundaries,
    openTurnStartHistoryIndex: index.openTurnStartHistoryIndex,
  };
}

function appendMessagesToDraft(
  draft: LeaderThreadRouteIndexDraft,
  messages: ReadonlyArray<LeaderThreadRouteIndexMessageLike>,
): LeaderThreadRouteIndexDraft {
  let openTurnStart = draft.openTurnStartHistoryIndex;
  let fingerprintHash = draft.sourceFingerprintHash;

  messages.forEach((message, offset) => {
    const absoluteIndex = draft.sourceHistoryLength + offset;
    const historyIndex = historyIndexForMessage(message, absoluteIndex);
    fingerprintHash = updateFingerprintHash(fingerprintHash, fingerprintPartForMessage(message, absoluteIndex));
    indexMessageThreadRoutes(draft.summaries, message, absoluteIndex);

    if (message.type === "user_message" || message.role === "user") {
      if (openTurnStart !== null) {
        draft.rawTurnBoundaries.push({
          turnIndex: draft.rawTurnBoundaries.length,
          startHistoryIndex: openTurnStart,
          endHistoryIndex: absoluteIndex - 1,
        });
      }
      openTurnStart = historyIndex;
      return;
    }

    if (message.type !== "result" || openTurnStart === null) return;
    draft.rawTurnBoundaries.push({
      turnIndex: draft.rawTurnBoundaries.length,
      startHistoryIndex: openTurnStart,
      endHistoryIndex: historyIndex,
    });
    openTurnStart = null;
  });

  draft.sourceHistoryLength += messages.length;
  draft.sourceFingerprintHash = fingerprintHash;
  draft.openTurnStartHistoryIndex = openTurnStart;
  return draft;
}

function finalizeDraft(draft: LeaderThreadRouteIndexDraft): LeaderThreadRouteIndex {
  const rawTurnBoundaries = draft.rawTurnBoundaries.map((boundary) => ({ ...boundary }));
  if (draft.openTurnStartHistoryIndex !== null) {
    rawTurnBoundaries.push({
      turnIndex: rawTurnBoundaries.length,
      startHistoryIndex: draft.openTurnStartHistoryIndex,
      endHistoryIndex: null,
    });
  }
  return {
    schemaVersion: LEADER_THREAD_ROUTE_INDEX_SCHEMA_VERSION,
    sourceHistoryLength: draft.sourceHistoryLength,
    sourceFingerprint: fingerprintString(draft.sourceFingerprintHash),
    sourceFingerprintHash: draft.sourceFingerprintHash,
    threadSummaries: [...draft.summaries.values()].sort(compareThreadSummaries),
    rawTurnBoundaries,
    openTurnStartHistoryIndex: draft.openTurnStartHistoryIndex,
  };
}

function indexMessageThreadRoutes(
  summaries: Map<string, LeaderProjectionThreadSummary>,
  message: LeaderThreadRouteIndexMessageLike,
  fallbackIndex: number,
): void {
  for (const key of messageThreadKeys(message)) {
    const timestamp = timestampForMessage(message);
    const historyIndex = historyIndexForMessage(message, fallbackIndex);
    const existing = summaries.get(key);
    if (!existing) {
      summaries.set(key, {
        threadKey: key,
        ...(isQuestThreadKey(key) ? { questId: key } : {}),
        messageCount: 1,
        firstMessageAt: timestamp,
        lastMessageAt: timestamp,
        firstHistoryIndex: historyIndex,
        lastHistoryIndex: historyIndex,
      });
      continue;
    }
    existing.messageCount += 1;
    existing.firstMessageAt = minDefined(existing.firstMessageAt, timestamp);
    existing.lastMessageAt = maxDefined(existing.lastMessageAt, timestamp);
    existing.firstHistoryIndex = minDefined(existing.firstHistoryIndex, historyIndex);
    existing.lastHistoryIndex = maxDefined(existing.lastHistoryIndex, historyIndex);
    if (!existing.questId && isQuestThreadKey(key)) existing.questId = key;
  }
}

function messageThreadKeys(message: LeaderThreadRouteIndexMessageLike): string[] {
  const keys = new Set<string>();
  const addThreadKey = (threadKey: string | undefined) => {
    if (!threadKey) return;
    const normalized = normalizeThreadKey(threadKey);
    if (!normalized || normalized === MAIN_THREAD_KEY) return;
    keys.add(normalized);
  };

  const metadata = message.metadata;
  addThreadKey(message.threadKey);
  addThreadKey(message.questId);
  addThreadKey(metadata?.threadKey);
  addThreadKey(metadata?.questId);
  addThreadKey(metadata?.quest?.questId);
  for (const ref of [...(message.threadRefs ?? []), ...(metadata?.threadRefs ?? [])]) {
    addThreadKey(ref.threadKey);
    addThreadKey(ref.questId);
  }

  const attachment = getThreadAttachmentMarker(message);
  addThreadKey(attachment?.threadKey);
  addThreadKey(attachment?.questId);
  addThreadKey(attachment?.sourceThreadKey);
  addThreadKey(attachment?.sourceQuestId);

  const transition = getThreadTransitionMarker(message);
  addThreadKey(transition?.threadKey);
  addThreadKey(transition?.questId);
  addThreadKey(transition?.sourceThreadKey);
  addThreadKey(transition?.sourceQuestId);

  for (const text of messageTextParts(message)) {
    const parsedPrefix = parseThreadTextPrefix(text);
    if (parsedPrefix.ok) addThreadKey(parsedPrefix.target.threadKey);
  }
  for (const block of messageContentBlocks(message)) {
    if (block.type !== "tool_use" || block.name !== "Bash" || typeof block.input?.command !== "string") continue;
    addThreadKey(parseCommandThreadComment(block.input.command)?.threadKey);
  }
  return [...keys];
}

function getThreadAttachmentMarker(message: LeaderThreadRouteIndexMessageLike): ThreadAttachmentMarker | undefined {
  if (message.metadata?.threadAttachmentMarker) return message.metadata.threadAttachmentMarker;
  return message.type === "thread_attachment_marker" ? (message as ThreadAttachmentMarker) : undefined;
}

function getThreadTransitionMarker(message: LeaderThreadRouteIndexMessageLike): ThreadTransitionMarker | undefined {
  if (message.metadata?.threadTransitionMarker) return message.metadata.threadTransitionMarker;
  return message.type === "thread_transition_marker" ? (message as ThreadTransitionMarker) : undefined;
}

function messageTextParts(message: LeaderThreadRouteIndexMessageLike): string[] {
  const texts: string[] = [];
  if (typeof message.content === "string") texts.push(message.content);
  for (const block of messageContentBlocks(message)) {
    if (block.type === "text") texts.push(block.text);
  }
  return texts;
}

function messageContentBlocks(message: LeaderThreadRouteIndexMessageLike): ContentBlock[] {
  if (Array.isArray(message.contentBlocks)) return message.contentBlocks;
  const rawMessage = message.message as { content?: unknown } | null | undefined;
  if (Array.isArray(rawMessage?.content)) return rawMessage.content as ContentBlock[];
  return [];
}

function timestampForMessage(message: LeaderThreadRouteIndexMessageLike): number {
  return typeof message.timestamp === "number" ? message.timestamp : 0;
}

function historyIndexForMessage(message: LeaderThreadRouteIndexMessageLike, fallback: number): number {
  return typeof message.historyIndex === "number" ? message.historyIndex : fallback;
}

function messageIdentityForFingerprint(message: LeaderThreadRouteIndexMessageLike, fallbackIndex: number): string {
  if (typeof message.id === "string" && message.id) return message.id;
  const raw = message as { message?: { id?: string }; data?: { uuid?: string }; cliUuid?: string };
  return raw.message?.id ?? raw.data?.uuid ?? raw.cliUuid ?? `history-${fallbackIndex}`;
}

function fingerprintPartForMessage(message: LeaderThreadRouteIndexMessageLike, fallbackIndex: number): string {
  return [
    fallbackIndex,
    historyIndexForMessage(message, fallbackIndex),
    timestampForMessage(message),
    message.type ?? "",
    message.role ?? "",
    messageIdentityForFingerprint(message, fallbackIndex),
    messageThreadKeys(message).join(","),
  ].join(":");
}

function updateFingerprintHash(current: number, part: string): number {
  let hash = current >>> 0;
  for (let index = 0; index < part.length; index++) {
    hash ^= part.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  hash ^= 0xff;
  return Math.imul(hash, FNV_PRIME) >>> 0;
}

function fingerprintString(hash: number): string {
  return hash.toString(16).padStart(8, "0");
}

function normalizeThreadKey(threadKey: string): string {
  return threadKey.trim().toLowerCase();
}

function compareThreadSummaries(a: LeaderProjectionThreadSummary, b: LeaderProjectionThreadSummary): number {
  const aFirst = a.firstMessageAt ?? Number.MAX_SAFE_INTEGER;
  const bFirst = b.firstMessageAt ?? Number.MAX_SAFE_INTEGER;
  if (aFirst !== bFirst) return aFirst - bFirst;
  return a.threadKey.localeCompare(b.threadKey);
}

function minDefined(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.min(a, b);
}

function maxDefined(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.max(a, b);
}

function isQuestThreadKey(threadKey: string): boolean {
  return /^q-\d+$/i.test(threadKey.trim());
}
