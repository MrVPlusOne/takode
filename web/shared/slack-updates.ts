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
}

const SECTION_HEADER = /^(?:=== THREAD PARENT MESSAGE ===|=== THREAD REPLIES\b.*===|--- Reply \d+ of \d+ ---)\s*$/;
const CHANNEL_MESSAGE_HEADER = /^=== Message from (.+) at (.+?) ===\s*$/;
const TRAILING_METADATA = /^(?:Reactions: .*|Thread: \d+ repl(?:y|ies)\b.*)$/;

/**
 * The messages in the text of a `slack_read_thread` or `slack_read_channel`
 * result, in the order printed. Each message is a header (`=== Message from
 * <author> at <time> ===`, or a thread section followed by `From:` and `Time:`
 * lines), a `Message TS:` line and its text; the reactions and reply counts
 * Slack prints after the text are dropped.
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
  } | null = null;
  const finish = () => {
    if (current)
      messages.push({
        ts: current.ts,
        author: current.author,
        time: current.time,
        text: body(current.lines),
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
    current?.lines.push(line);
  }
  finish();
  return messages;
}

/** The `#channel` or other name a `slack_read_channel` result starts with. */
export function parseSlackChannelName(text: string): string | null {
  return text.match(/^Channel: (.+?) \([A-Z0-9]+\)\s*$/m)?.[1] ?? null;
}

/**
 * The text of a Slack tool result, from a Claude `tool_result` block's content
 * or an MCP `callTool` result's content: the tools return JSON whose `messages`
 * field holds the printed conversation.
 */
export function slackToolResultText(content: unknown): string {
  const raw =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .map((block) => (block && typeof block === "object" && "text" in block ? String(block.text) : ""))
            .join("\n")
        : "";
  try {
    const parsed = JSON.parse(raw) as { messages?: unknown };
    if (typeof parsed?.messages === "string") return parsed.messages;
  } catch {
    // Not JSON: the tool printed the conversation directly.
  }
  return raw;
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

/** The notice a session gets with its next input; `updates` all have new messages. */
export function formatSlackUpdatesNotice(updates: readonly SlackUpdate[]): string {
  const total = updates.reduce((sum, update) => sum + update.messages.length + update.omitted, 0);
  const lines = [
    `${SLACK_UPDATES_TAG} ${plural(total, "new message")} in ${plural(updates.length, "Slack conversation")} you read earlier. ` +
      "They arrived after you last saw these conversations; act on them only if they change your work.",
  ];
  for (const update of updates) {
    const tool = update.threadTs
      ? `\`slack_read_thread\` (channel_id \`${update.channelId}\`, message_ts \`${update.threadTs}\`)`
      : `\`slack_read_channel\` (channel_id \`${update.channelId}\`)`;
    const where = update.threadKey ? ` You read it in thread ${update.threadKey}.` : "";
    lines.push(
      "",
      `### ${update.threadTs ? "Thread" : "Direct messages"}: ${update.label}`,
      `Read it with ${tool}.${where}`,
    );
    for (const message of update.messages) {
      lines.push("", `**${message.author || "Someone"}** (${message.time})`, quote(message.text));
    }
    if (update.omitted > 0) {
      lines.push(
        "",
        `${plural(update.omitted, "newer message")} did not fit here; read the ${update.threadTs ? "thread" : "conversation"} to see ${update.omitted === 1 ? "it" : "them"}.`,
      );
    }
  }
  return lines.join("\n");
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

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
