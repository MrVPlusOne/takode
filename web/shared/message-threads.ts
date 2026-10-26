import type { BrowserIncomingMessage } from "../server/session-types.js";
import { leaderResponseOriginalThreadKey } from "./leader-thread-response-routing.js";
import {
  inferThreadTargetFromTextContent,
  parseCommandThreadComment,
  parseThreadTextPrefix,
} from "./thread-routing.js";

/**
 * Which threads a message of a leader's history belongs to: the one rule that thread windows, live
 * delivery and leader projections share. A message is in every quest thread it is routed or
 * attached to, and in Main unless it is routed elsewhere.
 *
 * Reading a message's threads can parse its text (a `[thread:q-N]` prefix, a thread comment in its
 * first command, a herd event's target), and those readers each go through the whole history, so
 * each message's answer is kept and worked out again only when its routing changes: attaching it
 * to a thread adds a thread ref in place, and nothing else about a stored message changes.
 */

const MAIN = "main";

export type ThreadRoute = { threadKey: string; questId?: string };

/** A message's quest threads: by every route (`all`), or without backfill attachments (`explicit`). */
interface RouteKeys {
  all: ReadonlySet<string>;
  explicit: ReadonlySet<string>;
}

interface Memo extends RouteKeys {
  /** The route the message's text names (a thread prefix or comment, a herd event's target). */
  textRoute: ThreadRoute | null;
  threadKey: unknown;
  questId: unknown;
  threadRefs: unknown;
  refCount: number;
  text: unknown;
  textLength: number;
}

const memos = new WeakMap<object, Memo>();
const NO_KEYS: ReadonlySet<string> = new Set();

/**
 * The quest threads a message is routed or attached to. Without `includeBackfill`, attachments
 * made after the fact (backfill) don't count: those leave a message where it was written.
 */
export function messageQuestThreads(message: BrowserIncomingMessage, includeBackfill = true): ReadonlySet<string> {
  const keys = routeKeys(message);
  return includeBackfill ? keys.all : keys.explicit;
}

/** Whether a message belongs to a quest thread. */
export function messageHasThreadRef(message: BrowserIncomingMessage, threadKey: string): boolean {
  return routeKeys(message).all.has(normalizeKey(threadKey));
}

/** Whether a message is routed away from Main (an answer that began in Main stays there). */
export function hasExplicitNonMainRoute(message: BrowserIncomingMessage): boolean {
  if (leaderResponseOriginalThreadKey(message) === MAIN) return false;
  return routeKeys(message).explicit.size > 0;
}

/**
 * The threads a message belongs to by its own routing, exactly as thread windows place it: Main
 * unless it is routed elsewhere, and every quest it is routed or attached to. Attachment and
 * transition markers belong to no thread (Main shows them as summaries of their own). Null for a
 * message that carries no routing at all, whose thread only its context can tell (the turn it
 * streamed in, the tool it answers).
 */
export function messageThreadKeys(message: BrowserIncomingMessage): string[] | null {
  if (isMarker(message)) return [];
  const quests = [...routeKeys(message).all];
  if (quests.length === 0 && !message.threadKey && leaderResponseOriginalThreadKey(message) !== MAIN) return null;
  return hasExplicitNonMainRoute(message) ? quests : [MAIN, ...quests];
}

/** The first thread a message is explicitly routed to away from Main, if any. */
export function explicitNonMainRoute(message: BrowserIncomingMessage): ThreadRoute | null {
  if (isMarker(message)) return null;
  return routeFromMessageFields(message, false) ?? memoOf(message).textRoute;
}

/** Whether a message is a herd event injected into the leader. */
export function isHerdEventMessage(message: BrowserIncomingMessage): boolean {
  return (message as { agentSource?: { sessionId?: string } }).agentSource?.sessionId === "herd-events";
}

function routeKeys(message: BrowserIncomingMessage): RouteKeys {
  return isMarker(message) ? { all: NO_KEYS, explicit: NO_KEYS } : memoOf(message);
}

function memoOf(message: BrowserIncomingMessage): Memo {
  const text = textSource(message);
  const textLength = typeof text === "string" || Array.isArray(text) ? text.length : 0;
  const refCount = message.threadRefs?.length ?? 0;
  const memo = memos.get(message);
  if (
    memo &&
    memo.threadKey === message.threadKey &&
    memo.questId === message.questId &&
    memo.threadRefs === message.threadRefs &&
    memo.refCount === refCount &&
    memo.text === text &&
    memo.textLength === textLength
  ) {
    return memo;
  }
  const repaired = repairedRoute(message);
  const inferred = inferredHerdEventRoute(message);
  const next: Memo = {
    textRoute: repaired ?? inferred,
    threadKey: message.threadKey,
    questId: message.questId,
    threadRefs: message.threadRefs,
    refCount,
    text,
    textLength,
    all: computeRouteKeys(message, true, [repaired, inferred]),
    explicit: computeRouteKeys(message, false, [repaired, inferred]),
  };
  memos.set(message, next);
  return next;
}

function computeRouteKeys(
  message: BrowserIncomingMessage,
  includeBackfill: boolean,
  textRoutes: ReadonlyArray<ThreadRoute | null>,
): Set<string> {
  const keys = new Set<string>();
  const add = (value: string | undefined) => {
    if (!value) return;
    const normalized = normalizeKey(value);
    if (normalized !== MAIN) keys.add(normalized);
  };
  add(message.threadKey);
  add(message.questId);
  for (const ref of message.threadRefs ?? []) {
    if (!includeBackfill && ref.source === "backfill") continue;
    add(ref.threadKey);
    add(ref.questId);
  }
  for (const route of textRoutes) {
    add(route?.threadKey);
    add(route?.questId);
  }
  return keys;
}

function routeFromMessageFields(message: BrowserIncomingMessage, includeBackfill: boolean): ThreadRoute | null {
  if (isMarker(message)) return null;
  if (message.threadKey && normalizeKey(message.threadKey) !== MAIN) {
    return { threadKey: normalizeKey(message.threadKey), ...(message.questId ? { questId: message.questId } : {}) };
  }
  if (message.questId && normalizeKey(message.questId) !== MAIN) {
    return { threadKey: normalizeKey(message.questId), questId: message.questId };
  }
  const ref = (message.threadRefs ?? []).find(
    (candidate) => (includeBackfill || candidate.source !== "backfill") && normalizeKey(candidate.threadKey) !== MAIN,
  );
  if (!ref) return null;
  return { threadKey: normalizeKey(ref.threadKey), ...(ref.questId ? { questId: ref.questId } : {}) };
}

function repairedRoute(message: BrowserIncomingMessage): ThreadRoute | null {
  if (message.type === "user_message" || message.type === "leader_user_message") {
    const parsed = parseThreadTextPrefix(message.content);
    return parsed.ok ? parsed.target : null;
  }
  if (message.type !== "assistant") return null;
  const content = message.message.content;
  const firstText = content.find((block) => block.type === "text" && block.text.trim());
  if (firstText?.type === "text") {
    const parsed = parseThreadTextPrefix(firstText.text);
    if (parsed.ok) return parsed.target;
  }
  const firstBash = content.find(
    (block) => block.type === "tool_use" && block.name === "Bash" && typeof block.input?.command === "string",
  );
  if (!firstBash || firstBash.type !== "tool_use" || typeof firstBash.input.command !== "string") return null;
  return parseCommandThreadComment(firstBash.input.command);
}

function inferredHerdEventRoute(message: BrowserIncomingMessage): ThreadRoute | null {
  if (!isHerdEventMessage(message)) return null;
  const content = message.type === "user_message" ? message.content : null;
  if (typeof content !== "string") return null;
  const target = inferThreadTargetFromTextContent(content);
  if (!target || normalizeKey(target.threadKey) === MAIN) return null;
  return { threadKey: normalizeKey(target.threadKey), ...(target.questId ? { questId: target.questId } : {}) };
}

/** What a message's text routes are read from, to notice it changing. */
function textSource(message: BrowserIncomingMessage): unknown {
  if (message.type === "user_message" || message.type === "leader_user_message") return message.content;
  if (message.type === "assistant") return message.message.content;
  return undefined;
}

function isMarker(message: BrowserIncomingMessage): boolean {
  return message.type === "thread_attachment_marker" || message.type === "thread_transition_marker";
}

function normalizeKey(threadKey: string): string {
  return threadKey.trim().toLowerCase() || MAIN;
}
