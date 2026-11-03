import type { BrowserIncomingMessage } from "../session-types.js";
import type { LeaderThreadStatus } from "../../shared/thread-status-marker.js";
import { threadStatusKey } from "../../shared/thread-status-marker.js";
import { routeFromHistoryEntry } from "../thread-routing-metadata.js";

/** What made a commentary message look like something the user should read. */
export type FoldedResultSignal = "a draft" | "a visual" | "images" | "a table" | "a long message";

/** A thread whose newest leader message is commentary the user's feed will fold away. */
export interface FoldedResult {
  threadKey: string;
  signals: FoldedResultSignal[];
}

/** Commentary at least this long reads like a result rather than a progress note. */
const LONG_COMMENTARY_CHARS = 1500;

/**
 * Threads whose newest leader message in `history[startIndex..]` is commentary that carries
 * something the user should read, with no final message (answer or result, report, question)
 * after it. The feed folds commentary before a thread's newest final message and collapses a
 * Ready thread's turn, so such commentary is easily never seen (Jiayi, Nov 3: a finished
 * prototype's result, screenshots and a PR draft posted as commentary vanished under Ready).
 * A draft is flagged whatever the thread's status; other signals only once the thread is Ready.
 */
export function findFoldedResults(
  history: readonly BrowserIncomingMessage[],
  startIndex: number,
  statuses: Readonly<Record<string, LeaderThreadStatus>> | undefined,
): FoldedResult[] {
  const newest = new Map<string, { index: number; signals: FoldedResultSignal[] }>();
  for (let index = Math.max(0, startIndex); index < history.length; index += 1) {
    const entry = history[index]!;
    if (entry.type !== "assistant" || entry.parent_tool_use_id !== null) continue;
    if (entry.leaderThreadRole !== "commentary") continue;
    const threadKey = routeFromHistoryEntry(entry)?.threadKey;
    if (!threadKey || threadStatusKey(threadKey) === "main") continue;
    const text = entry.message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
    const signals = resultSignals(text);
    // Shorter notes after it fold away with it, so the newest message that carries something counts.
    if (signals.length > 0) newest.set(threadStatusKey(threadKey), { index, signals });
  }
  const results: FoldedResult[] = [];
  for (const [threadKey, { index, signals }] of newest) {
    if (hasFinalAfter(history, index, threadKey)) continue;
    const ready = statuses?.[threadKey]?.kind === "ready";
    if (ready || signals.includes("a draft")) results.push({ threadKey, signals });
  }
  return results;
}

function resultSignals(text: string): FoldedResultSignal[] {
  const signals: FoldedResultSignal[] = [];
  if (/^\s*(`{3,}|~{3,})\s*draft\b/im.test(text)) signals.push("a draft");
  if (/^\s*(`{3,}|~{3,})\s*visual\b/im.test(text)) signals.push("a visual");
  if (/!\[[^\]]*\]\([^)]+\)|(?:^|[\s(])(?:~|\/)[^\s)]*\.(?:png|jpe?g|gif|webp)\b/im.test(text)) signals.push("images");
  if (/^\s*\|.*\|\s*$\n^\s*\|?\s*:?-{3,}/m.test(text)) signals.push("a table");
  if (text.trim().length >= LONG_COMMENTARY_CHARS) signals.push("a long message");
  return signals;
}

/** Whether a final message for the thread came after `index`: an answer that counted, a report or a question. */
function hasFinalAfter(history: readonly BrowserIncomingMessage[], index: number, threadKey: string): boolean {
  for (let next = index + 1; next < history.length; next += 1) {
    const entry = history[next]!;
    const route = routeFromHistoryEntry(entry)?.threadKey;
    if (!route || threadStatusKey(route) !== threadKey) continue;
    if (entry.type === "markdown_report") return true;
    if (entry.type !== "assistant") continue;
    if (entry.notification?.category === "needs-input") return true;
    if (entry.leaderThreadRole === "answer" && entry.threadAnswer) return true;
  }
  return false;
}
