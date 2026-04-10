/**
 * Shared parsing utilities for herd event messages injected by the
 * herd-event-dispatcher on the server.
 *
 * Used by both UI components (MessageBubble, MessageFeed) and data-model
 * hooks (use-feed-model) -- lives in utils/ to avoid cross-layer imports.
 */

/** Matches a real event header: "#<number> | <event_type> | ..."
 *  Distinguishes from markdown headings like "## Skeptic Review" which are
 *  key message content that belongs to the preceding event's activity. */
export const EVENT_HEADER_RE = /^#\d+\s*\|/;

export interface HerdEventParsed {
  header: string;
  activity: string[];
}

/** Parse herd event batch content into structured events with headers and activity lines.
 *
 *  Format contract (produced by formatHerdEventBatch + formatSingleEvent in
 *  web/server/herd-event-dispatcher.ts):
 *    "N events from N sessions\n\n"         <- batch header (skipped)
 *    "#5 | turn_end | ✓ 15.3s | ...\n"      <- event header (matches EVENT_HEADER_RE)
 *    "  [169] user: \"Fix bug\"\n"           <- activity line (2-space indent)
 *    "  [170] asst: Edit: auth.ts\n"         <- activity line
 *    "## Skeptic Review\n### Task\n..."      <- key message content (NOT an event header)
 *    "#6 | permission_request | ...\n"       <- next event header
 *
 *  The batch header ("N events from N sessions") is safely excluded because
 *  it appears before any #N | ... line, so events.length === 0 at that point. */
export function parseHerdEvents(content: string): HerdEventParsed[] {
  const events: HerdEventParsed[] = [];
  const lines = content.split("\n");

  for (const line of lines) {
    if (EVENT_HEADER_RE.test(line)) {
      events.push({ header: line, activity: [] });
    } else if (events.length > 0 && line.trim().length > 0) {
      // Any non-empty line after an event header is activity content,
      // including markdown headings from key message content
      events[events.length - 1].activity.push(line);
    }
  }

  return events;
}

// ─── Shared UI constants ────────────────────────────────────────────────────

/** Base className for herd event chip buttons (shared by HerdEventEntry and HerdEventBatchGroup). */
export const HERD_CHIP_BASE =
  "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-mono-code leading-snug border border-amber-500/20 bg-amber-500/5 text-cc-muted";

/** Hover/interactive addition to HERD_CHIP_BASE for clickable chips. */
export const HERD_CHIP_INTERACTIVE =
  "cursor-pointer hover:bg-amber-500/10 hover:border-amber-500/30 transition-colors";
