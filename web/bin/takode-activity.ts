import type { ActivityMessage, ActivityThread } from "../server/activity-stream.js";
import {
  apiGet,
  err,
  escapeTerminalText,
  formatDate,
  formatTime,
  formatTimestampCompact,
  parseFlags,
} from "./takode-core.js";

interface ActivityResponse {
  since: number;
  until: number;
  spaces: string[] | null;
  threads: ActivityThread[];
  unreadable?: Array<{ session: number | null; error: string }>;
}

/** `takode activity`: the user's hand-typed messages and the final messages they were shown in a time window. */
export async function handleActivity(base: string, args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const now = Date.now();
  const params = new URLSearchParams();
  if (typeof flags.since === "string") params.set("since", String(parseActivityTime(flags.since, now)));
  if (typeof flags.until === "string") params.set("until", String(parseActivityTime(flags.until, now)));
  if (typeof flags.space === "string") params.set("space", flags.space);
  if (flags.full === true) params.set("full", "1");

  const response = (await apiGet(base, `/takode/activity?${params.toString()}`, {
    auth: "optional",
  })) as ActivityResponse;
  if (flags.json === true) {
    console.log(JSON.stringify(response, null, 2));
    return;
  }
  console.log(formatActivity(response, flags.full === true));
}

/**
 * Parse a window bound: a duration ago (`30m`, `6h`, `2d`), `today`/`yesterday` (local
 * midnight), a local date (`2026-10-10`), a date and time, or epoch milliseconds.
 */
export function parseActivityTime(value: string, now: number): number {
  const trimmed = value.trim().toLowerCase();
  const ago = /^(\d+(?:\.\d+)?)(m|h|d)$/.exec(trimmed);
  if (ago) return now - Number(ago[1]) * { m: 60_000, h: 3_600_000, d: 86_400_000 }[ago[2] as "m" | "h" | "d"];
  if (trimmed === "today" || trimmed === "yesterday") {
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    if (trimmed === "yesterday") midnight.setDate(midnight.getDate() - 1);
    return midnight.getTime();
  }
  if (/^\d{10,}$/.test(trimmed)) return Number(trimmed);
  // A bare date is local midnight; JavaScript would otherwise read it as UTC.
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T00:00` : value.trim()).getTime();
  if (!Number.isFinite(parsed)) {
    err(
      `Cannot read time "${value}". Use a duration ago (6h, 2d), today, yesterday, a date (2026-10-10) or a date and time.`,
    );
  }
  return parsed;
}

/**
 * Render each session thread as a narrative. An answer names the user messages it
 * answers unless they are exactly the unanswered ones just above it; an answer that
 * names none is marked as a new result.
 */
export function formatActivity(response: ActivityResponse, full: boolean): string {
  const messages = response.threads.flatMap((thread) => thread.messages);
  const answered = new Set(messages.flatMap((message) => message.to ?? []));
  const userCount = messages.filter((message) => message.role === "user").length;
  const unanswered = messages.filter((message) => message.role === "user" && !answered.has(message.index)).length;
  const newResults = messages.filter((message) => message.role === "answer" && !message.to).length;
  const reports = messages.filter((message) => message.role === "report").length;
  const lines = [
    `Activity ${formatDate(response.since)} ${formatTime(response.since)} → ${formatDate(response.until)} ${formatTime(response.until)} · ${
      response.spaces ? `space ${response.spaces.join(", ")}` : "all spaces"
    } · ${userCount} user message${userCount === 1 ? "" : "s"}${unanswered ? ` (${unanswered} unanswered)` : ""}${
      newResults ? ` · ${newResults} new result${newResults === 1 ? "" : "s"}` : ""
    }${reports ? ` · ${reports} report${reports === 1 ? "" : "s"}` : ""}`,
    `Open a message: takode read <session> <msg>.${full ? "" : " Whole messages: --full."} Structured: --json.`,
  ];
  for (const unreadable of response.unreadable ?? []) {
    lines.push(
      `Could not read archived session #${unreadable.session ?? "?"}: ${escapeTerminalText(unreadable.error)}`,
    );
  }

  const showSpace = response.spaces?.length !== 1;
  for (const thread of response.threads) {
    lines.push(
      "",
      `#${thread.session ?? "?"} ${escapeTerminalText(thread.sessionName)}${showSpace ? ` [${thread.space}]` : ""}${
        thread.thread ? ` · ${thread.thread}` : ""
      }`,
    );
    let open: number[] = [];
    for (const message of thread.messages) {
      if (message.role === "user") {
        open.push(message.index);
        lines.push(formatMessage(message, full, answered.has(message.index) ? "" : "unanswered"));
        continue;
      }
      if (!message.to) {
        lines.push(formatMessage(message, full, message.role === "answer" ? "new result" : ""));
        continue;
      }
      const to = message.to;
      const obvious = to.length === open.length && to.every((index) => open.includes(index));
      open = open.filter((index) => !to.includes(index));
      lines.push(formatMessage(message, full, obvious ? "" : `to ${to.join(", ")}`));
    }
  }
  return lines.join("\n");
}

function formatMessage(message: ActivityMessage, full: boolean, note: string): string {
  const extras = [
    note,
    message.images ? `${message.images} image${message.images === 1 ? "" : "s"}` : "",
    message.chars ? `${message.chars} chars` : "",
  ].filter(Boolean);
  const prefix = `  ${formatTimestampCompact(message.at)} ${message.role} [${message.index}]${
    extras.length ? ` (${extras.join(", ")})` : ""
  }:`;
  if (!full) return `${prefix} ${escapeTerminalText(message.text.replace(/\s+/g, " "))}`;
  const body = message.text
    .split("\n")
    .map((line) => `    ${escapeTerminalText(line)}`)
    .join("\n");
  return `${prefix}\n${body}`;
}
