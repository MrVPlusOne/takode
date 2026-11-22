/**
 * Slack updates: new messages in Slack conversations an agent read earlier,
 * attached to its next input so it does not keep acting on an old picture of
 * the discussion. The server parses what Slack's MCP tools return and writes
 * the notice; the browser shows the notice as a collapsed chip.
 */

/** Sender of the Slack updates notice attached to a session's next input. */
export const SLACK_UPDATES_SOURCE = {
  sessionId: "system:slack-updates",
  sessionLabel: "Slack updates",
} as const;

export const SLACK_UPDATES_TAG = "[Slack updates]";

/** One Slack message as Slack's MCP read tools print it. */
export interface SlackMessage {
  /** Slack's message timestamp, its id within the conversation (`1794358314.762619`). */
  ts: string;
  author: string;
  /** The time as Slack's tool printed it, with its time zone. */
  time: string;
  text: string;
  /** For a reply in a thread, the timestamp of the thread's first message. */
  threadTs?: string;
  /** For a message that started a thread, how many replies Slack showed under it. */
  replies?: number;
}

/** New messages in one watched conversation, ready to tell the session about. */
export interface SlackUpdate {
  channelId: string;
  /** The watched thread; absent when a whole direct-message conversation is watched. */
  threadTs?: string;
  /** The thread's first line, or the direct-message conversation's name. */
  label: string;
  /** The new messages included, oldest first. */
  messages: SlackMessage[];
  /** Newer messages that did not fit in the notice. */
  omitted: number;
  /** The leader thread the session read the conversation in, when not Main. */
  threadKey?: string;
  /** The first notice about this conversation: name it and say where it was read. Later ones only carry its ID. */
  introduce: boolean;
}

const SECTION_HEADER = /^(?:=== THREAD PARENT MESSAGE ===|=== THREAD REPLIES\b.*===|--- Reply \d+ of \d+ ---)\s*$/;
const CHANNEL_MESSAGE_HEADER = /^=== Message from (.+) at (.+?) ===\s*$/;
const TRAILING_METADATA = /^Reactions: .*$/;
/** Slack prints this after a message that started a thread, before any reactions or forwarded text. */
const THREAD_SUMMARY = /^Thread: (\d+) repl(?:y|ies) \(latest: .*\)\s*$/;

/**
 * The messages in the text of a `slack_read_thread` or `slack_read_channel`
 * result, in the order printed. Each message is a header (`=== Message from
 * <author> at <time> ===`, or a thread section followed by `From:` and `Time:`
 * lines), a `Message TS:` line and its text. The reactions Slack prints after
 * the text are dropped; a thread's reply count is kept as `replies`.
 */
export function parseSlackMessages(text: string): SlackMessage[] {
  const messages: SlackMessage[] = [];
  let author = "";
  let time = "";
  let inHeader = false;
  let current: {
    ts: string;
    author: string;
    time: string;
    lines: string[];
    replies?: number;
  } | null = null;
  const finish = () => {
    if (current)
      messages.push({
        ts: current.ts,
        author: current.author,
        time: current.time,
        text: body(current.lines),
        ...(current.replies ? { replies: current.replies } : {}),
      });
    current = null;
  };
  for (const line of text.split(/\r?\n/)) {
    const channelHeader = line.match(CHANNEL_MESSAGE_HEADER);
    if (channelHeader || SECTION_HEADER.test(line)) {
      finish();
      author = channelHeader ? withoutUserId(channelHeader[1]!) : "";
      time = channelHeader?.[2] ?? "";
      inHeader = true;
      continue;
    }
    if (inHeader) {
      const ts = line.match(/^Message TS: (\d+\.\d+)\s*$/)?.[1];
      if (ts) {
        current = { ts, author, time, lines: [] };
        inHeader = false;
        continue;
      }
      const from = line.match(/^From: (.+)$/)?.[1];
      if (from) author = withoutUserId(from);
      const at = line.match(/^Time: (.+)$/)?.[1];
      if (at) time = at;
      continue;
    }
    const replies = current && line.match(THREAD_SUMMARY)?.[1];
    if (current && replies) {
      current.replies = Number(replies);
      continue;
    }
    current?.lines.push(line);
  }
  finish();
  return messages;
}

/**
 * The messages in the text of a detailed `slack_search_*` result, in the order
 * printed. Each result has `From:`, `Time:` and `Message_ts:` lines, a
 * `Permalink:` whose `thread_ts` names the thread a reply belongs to (a thread's
 * first message names itself), an optional `Reply count:` and the text after
 * `Text:`.
 */
export function parseSlackSearchMessages(text: string): SlackMessage[] {
  const messages: SlackMessage[] = [];
  for (const block of text.split(/^### Result \d+ of \d+\s*$/m).slice(1)) {
    const ts = block.match(/^Message_ts: (\d+\.\d+)\s*$/m)?.[1];
    if (!ts) continue;
    const threadTs = block.match(/^Permalink: .*[?&]thread_ts=(\d+\.\d+)/m)?.[1];
    const replies = Number(block.match(/^Reply count: (\d+)\s*$/m)?.[1] ?? 0);
    const textStart = block.match(/^Text: ?/m);
    const lines = textStart ? block.slice(textStart.index! + textStart[0].length).split(/\r?\n/) : [];
    // Each result ends with a `---` line before the next one.
    while (lines.length > 0 && /^(?:---)?\s*$/.test(lines.at(-1)!)) lines.pop();
    messages.push({
      ts,
      // `From: Ada Lovelace (ID: U123)`, with ` [BOT]` after a bot's.
      author: (block.match(/^From: (.*)$/m)?.[1] ?? "").replace(/\s*\(ID: [A-Z0-9]+\)\s*(?:\[BOT\])?\s*$/, "").trim(),
      time: block.match(/^Time: (.+)$/m)?.[1]?.trim() ?? "",
      text: body(lines),
      ...(threadTs && threadTs !== ts ? { threadTs } : {}),
      ...(replies ? { replies } : {}),
    });
  }
  return messages;
}

/** The cursor for the next page of a `slack_search_*` result, or null on its last page. */
export function parseSlackSearchCursor(pagination: string): string | null {
  return pagination.match(/use cursor `([^`]+)`/)?.[1] ?? null;
}

/** The `#channel` or other name a `slack_read_channel` result starts with. */
export function parseSlackChannelName(text: string): string | null {
  return text.match(/^Channel: (.+?) \([A-Z0-9]+\)\s*$/m)?.[1] ?? null;
}

/**
 * The text of a Slack tool result, from a Claude `tool_result` block's content
 * or an MCP `callTool` result's content: the tools return JSON whose `messages`
 * (or, for searches, `results`) field holds the printed text.
 */
export function slackToolResultText(content: unknown): string {
  return parseSlackToolResult(content).messages;
}

/** The paging note of a Slack tool result, such as "There are more messages in this thread." */
export function slackToolResultPagination(content: unknown): string {
  return parseSlackToolResult(content).pagination;
}

/** Order two Slack timestamps. They exceed double precision, so compare the parts. */
export function compareSlackTs(a: string, b: string): number {
  const [aSeconds = "0", aFraction = ""] = a.split(".");
  const [bSeconds = "0", bFraction = ""] = b.split(".");
  if (aSeconds.length !== bSeconds.length) return aSeconds.length - bSeconds.length;
  if (aSeconds !== bSeconds) return aSeconds < bSeconds ? -1 : 1;
  const width = Math.max(aFraction.length, bFraction.length);
  const left = aFraction.padEnd(width, "0");
  const right = bFraction.padEnd(width, "0");
  return left === right ? 0 : left < right ? -1 : 1;
}

/**
 * The notice a session gets with its next input; `updates` all have new
 * messages. Each conversation is named by its ID (`channel/ts` for a thread,
 * the channel for a direct-message conversation), which is also what the read
 * tools take. Its title appears only in its first notice, and the reading
 * instructions only with `explain`, the session's first notice, so repeated
 * updates carry little more than the new messages.
 *
 * With `linkOrigin` (the Slack workspace's web address, such as
 * `https://acme.slack.com`), each conversation also gets an "Open in Slack"
 * link to its first new message. That is for the copy people see in the feed;
 * the agent's copy leaves it out, since the ID is all its tools need.
 */
export function formatSlackUpdatesNotice(
  updates: readonly SlackUpdate[],
  options: { explain: boolean; linkOrigin?: string },
): string {
  const total = updates.reduce((sum, update) => sum + update.messages.length + update.omitted, 0);
  const lines = [`${SLACK_UPDATES_TAG} ${plural(total, "new message")} in Slack conversations you read.`];
  if (options.explain) {
    lines.push(
      "Only messages you have not seen are shown, under the conversation's ID: `<channel_id>/<message_ts>` for a thread " +
        "(read it all with `slack_read_thread`), or a direct or group message conversation's `<channel_id>` (`slack_read_channel`). " +
        "Replies (↳) follow the message that started their thread, or an `In thread <id>` line, and a time without a date is on the date shown last. " +
        "Act on them only if they change your work, and run `takode slack stop <id>` once its topic is closed.",
    );
  }
  // A time repeats its date and time zone only when they differ from the last time shown.
  const clock = { day: "" };
  for (const update of updates) {
    const id = `\`${slackConversationId(update)}\``;
    const intro = update.introduce
      ? `: ${update.threadTs ? "thread" : "direct messages"} "${update.label}"${update.threadKey ? `, read in ${update.threadKey}` : ""}`
      : "";
    const link = options.linkOrigin ? ` · [Open in Slack](${slackUpdateUrl(options.linkOrigin, update)})` : "";
    lines.push("", `${id}${intro}${link}`);
    for (const entry of threadEntries(update)) {
      const threadId = `\`${update.channelId}/${entry.threadTs}\``;
      if (entry.message) {
        // With its replies below, Slack's earlier reply count would only confuse.
        const note =
          entry.replies.length > 0
            ? ` · thread ${threadId}`
            : entry.message.replies
              ? ` · ${plural(entry.message.replies, "reply", "replies")} in thread ${threadId}`
              : "";
        lines.push(...messageLines(entry.message, clock, "", note));
      } else {
        lines.push("", `In thread ${threadId}:`);
      }
      for (const reply of entry.replies) lines.push(...messageLines(reply, clock, "↳ ", ""));
    }
    if (update.omitted > 0) lines.push("", `+${plural(update.omitted, "newer message")} not shown.`);
  }
  return lines.join("\n");
}

/** How a notice names a conversation: `channel/ts` for a thread, the channel for direct messages. */
export function slackConversationId(update: Pick<SlackUpdate, "channelId" | "threadTs">): string {
  return update.threadTs ? `${update.channelId}/${update.threadTs}` : update.channelId;
}

/**
 * The web address (`https://<workspace>.slack.com`) of the first Slack
 * permalink in a `slack_search_*` result, or null when it shows none.
 */
export function parseSlackPermalinkOrigin(content: unknown): string | null {
  const url = slackToolResultText(content).match(/^Permalink: \[[^\]]*\]\((https:\/\/[^)\s]+)\)/m)?.[1];
  if (!url) return null;
  try {
    const { hostname, origin } = new URL(url);
    return hostname === "slack.com" || hostname.endsWith(".slack.com") ? origin : null;
  } catch {
    return null;
  }
}

/** One message and the replies that follow it in a notice. */
interface ThreadEntry {
  /** The message, absent for replies whose thread's first message is not in the update. */
  message?: SlackMessage;
  /** The thread the message started, or the replies' thread. */
  threadTs: string;
  replies: SlackMessage[];
}

/**
 * The messages of an update in the order a notice shows them: each message,
 * followed by the replies in its thread. Replies whose thread started before
 * the update sit together under their thread, where the first of them came.
 * A watched thread's messages are all its own and need no grouping.
 */
function threadEntries(update: SlackUpdate): ThreadEntry[] {
  if (update.threadTs) return update.messages.map((message) => ({ message, threadTs: message.ts, replies: [] }));
  const entries: ThreadEntry[] = [];
  const byThread = new Map<string, ThreadEntry>();
  for (const message of [...update.messages].sort((a, b) => compareSlackTs(a.ts, b.ts))) {
    if (!message.threadTs) {
      const entry = { message, threadTs: message.ts, replies: [] };
      entries.push(entry);
      byThread.set(message.ts, entry);
      continue;
    }
    let entry = byThread.get(message.threadTs);
    if (!entry) {
      entry = { threadTs: message.threadTs, replies: [] };
      entries.push(entry);
      byThread.set(message.threadTs, entry);
    }
    entry.replies.push(message);
  }
  return entries;
}

/** A message's lines in a notice: who and when, then its text quoted. */
function messageLines(message: SlackMessage, clock: { day: string }, prefix: string, note: string): string[] {
  // A blank line ends the quote above, or Markdown folds the next line into it.
  return [
    "",
    `${prefix}**${message.author || "Someone"}** ${shortTime(message.time, clock)}${note}`,
    quote(message.text),
  ];
}

/**
 * A Slack time (`2026-11-21 23:25:28 PST`) as hours and minutes, with its date
 * and time zone only when they differ from the time shown before. Other forms
 * are shown as Slack printed them.
 */
function shortTime(time: string, clock: { day: string }): string {
  const parts = time.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})(?::\d{2})? (\S+)$/);
  if (!parts) return time;
  const [, date, hoursMinutes, zone] = parts;
  const day = `${date} ${zone}`;
  if (day === clock.day) return hoursMinutes!;
  clock.day = day;
  return `${date} ${hoursMinutes} ${zone}`;
}

/**
 * Where an update starts in Slack: its first new message, opened in its thread
 * for a thread reply, or the conversation when no message is kept.
 */
function slackUpdateUrl(origin: string, update: SlackUpdate): string {
  const first = update.messages[0];
  const ts = first?.ts ?? update.threadTs;
  const base = `${origin}/archives/${update.channelId}`;
  if (!ts) return base;
  const message = `${base}/p${ts.replace(".", "")}`;
  const threadTs = update.threadTs ?? first?.threadTs;
  return threadTs && ts !== threadTs ? `${message}?thread_ts=${threadTs}&cid=${update.channelId}` : message;
}

function parseSlackToolResult(content: unknown): { messages: string; pagination: string } {
  const raw =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .map((block) => (block && typeof block === "object" && "text" in block ? String(block.text) : ""))
            .join("\n")
        : "";
  try {
    const parsed = JSON.parse(raw) as { messages?: unknown; results?: unknown; pagination_info?: unknown };
    // Read tools put the conversation in `messages`, search tools in `results`.
    const text = parsed?.messages ?? parsed?.results;
    if (typeof text === "string") {
      return {
        messages: text,
        pagination: typeof parsed.pagination_info === "string" ? parsed.pagination_info : "",
      };
    }
  } catch {
    // Not JSON: the tool printed the conversation directly.
  }
  return { messages: raw, pagination: "" };
}

function body(lines: string[]): string {
  const kept = [...lines];
  while (kept.length > 0 && (kept.at(-1)!.trim() === "" || TRAILING_METADATA.test(kept.at(-1)!))) kept.pop();
  while (kept.length > 0 && kept[0]!.trim() === "") kept.shift();
  return kept.join("\n");
}

function withoutUserId(name: string): string {
  return name.replace(/\s*\([A-Z0-9]+\)\s*$/, "").trim();
}

function quote(text: string): string {
  return (text || "(no text)")
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function plural(count: number, noun: string, nouns = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : nouns}`;
}
