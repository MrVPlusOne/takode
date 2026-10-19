/**
 * Held quiet turns in a leader's herd inbox. A worker turn that ended with an
 * accepted quiet marker never wakes the leader by itself: it waits in the inbox,
 * merged into one entry per worker, and rides along when a real event for the
 * same thread is delivered. Held entries carry nothing to act on, so a server
 * restart may drop them.
 */
import type { BoardRow, TakodeEvent } from "./session-types.js";
import type { ThreadRouteMetadata } from "./thread-routing-metadata.js";
import { routeKey } from "./thread-routing-metadata.js";

type TurnEndEvent = Extract<TakodeEvent, { event: "turn_end" }>;

export function isHeldQuietTurn(event: TakodeEvent): boolean {
  return event.event === "turn_end" && !!event.data.quiet;
}

/**
 * A quiet turn may not hide a Journey change: the leader must see a worker's
 * phase transition. Any update to the worker's board row during the turn counts.
 */
export function overrideQuietForBoardChange(event: TakodeEvent, board: Map<string, BoardRow> | undefined): TakodeEvent {
  if (event.event !== "turn_end" || !event.data.quiet || !board) return event;
  const turnStartedAt = event.ts - event.data.duration_ms;
  for (const row of board.values()) {
    if (row.worker !== event.sessionId || row.updatedAt < turnStartedAt) continue;
    const { quiet: _quiet, ...data } = event.data;
    return { ...event, data: { ...data, quiet_ignored: "the quest's board row changed" } };
  }
  return event;
}

/** Fold an earlier held quiet turn from the same worker into the new one. */
export function mergeHeldQuietTurn(previous: TakodeEvent, next: TakodeEvent): TakodeEvent {
  if (previous.event !== "turn_end" || next.event !== "turn_end" || !previous.data.quiet || !next.data.quiet)
    return next;
  const count = (previous.data.quiet.count ?? 1) + (next.data.quiet.count ?? 1);
  return { ...next, data: { ...next.data, quiet: { summary: next.data.quiet.summary, count } } };
}

/**
 * Keep held quiet entries only where a waking entry shares their thread, so they
 * never start a delivery (and a leader turn) of their own.
 */
export function withRideAlongQuietEntries<T extends { event: TakodeEvent; threadRoute: ThreadRouteMetadata }>(
  entries: T[],
): T[] {
  const wakingRoutes = new Set(
    entries.filter((entry) => !isHeldQuietTurn(entry.event)).map((entry) => routeKey(entry.threadRoute)),
  );
  return entries.filter((entry) => !isHeldQuietTurn(entry.event) || wakingRoutes.has(routeKey(entry.threadRoute)));
}

/** One line per worker; the turn's activity is left out because the worker said it holds nothing for the leader. */
export function formatHeldQuietTurn(event: TurnEndEvent, label: string, ageSuffix: string): string {
  const count = event.data.quiet?.count ?? 1;
  const countText = count > 1 ? `${count} quiet turns, latest: ` : "";
  return `${label} | turn_end | quiet | ${countText}${event.data.quiet?.summary ?? ""}${ageSuffix}`;
}
