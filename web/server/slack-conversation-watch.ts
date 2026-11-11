import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { isSystemSourceId } from "../shared/injected-event-message.js";
import {
  compareSlackTs,
  formatSlackUpdatesNotice,
  parseSlackChannelName,
  parseSlackMessages,
  SLACK_UPDATES_SOURCE,
  slackToolResultText,
  type SlackMessage,
  type SlackUpdate,
} from "../shared/slack-updates.js";
import type { BrowserUserMessage } from "./bridge/adapter-browser-routing-message-types.js";
import { findToolUseBlockInHistory } from "./bridge/tool-result-recovery-controller.js";
import { normalizeAdapterUserMessage } from "./bridge/user-message-delivery.js";
import type { OpenSlackReader, SlackReadConnection } from "./slack-reader.js";
import type { BrowserIncomingMessage, ContentBlock } from "./session-types.js";

/**
 * When an agent reads a Slack conversation, the discussion often goes on
 * without it. Takode remembers each conversation a session read and how far it
 * read, checks those conversations for new messages every few minutes, and
 * attaches what arrived to the session's next input. It never wakes a session
 * for this, and it stops watching a conversation a week after the session last
 * read it.
 *
 * A session watches a thread it read with `slack_read_thread`, and a direct
 * message conversation it read with `slack_read_channel` after it was sent a
 * link into it. Other channel reads, such as a briefing scanning channels,
 * start nothing: the session reads those itself whenever it needs them.
 */

const POLL_INTERVAL_MS = 10 * 60_000;
const WATCH_WINDOW_MS = 7 * 24 * 60 * 60_000;
/** Text of new messages kept for one conversation; later messages are only counted. */
const MESSAGE_TEXT_BUDGET = 4_000;
const READ_TOOL = /(?:^|__|\.)slack_read_(thread|channel)$/;

interface WatchedConversation {
  sessionId: string;
  channelId: string;
  /** The watched thread; absent when a whole direct-message conversation is watched. */
  threadTs?: string;
  label: string;
  /** The newest message the session has seen, by reading or through a notice. */
  seenTs: string;
  lastReadAt: number;
  /** The leader thread the session last read it in, when not Main. */
  threadKey?: string;
  questId?: string;
  /** New messages not yet told to the session, oldest first. */
  pending: SlackMessage[];
  /** Newer messages past the text budget, only counted. */
  pendingOmitted: number;
  /** The newest new message, kept or counted. */
  pendingLatestTs?: string;
}

/** A conversation read in one tool result. */
export interface SlackRead {
  channelId: string;
  threadTs?: string;
  label: string;
  seenTs: string;
  threadKey?: string;
  questId?: string;
}

interface SessionLike {
  id: string;
  messageHistory: readonly BrowserIncomingMessage[];
}

export interface SlackConversationWatchOptions {
  statePath: string;
  openReader: OpenSlackReader;
  /** Whether the session still exists and is not archived. */
  isSessionActive: (sessionId: string) => boolean;
  now?: () => number;
  log?: (message: string) => void;
}

export class SlackConversationWatch {
  private conversations: WatchedConversation[] = [];
  private pendingWrite: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  private lastUnavailableReason: string | null = null;

  constructor(private readonly options: SlackConversationWatchOptions) {}

  async load(): Promise<void> {
    try {
      const saved = JSON.parse(await readFile(this.options.statePath, "utf-8")) as {
        conversations?: WatchedConversation[];
      };
      this.conversations = Array.isArray(saved.conversations) ? saved.conversations : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.log(`Ignoring unreadable ${this.options.statePath}: ${String(error)}`);
      }
      this.conversations = [];
    }
  }

  start(): void {
    this.timer ??= setInterval(() => void this.poll(), POLL_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** The session read a conversation up to `read.seenTs`: watch it, or move its seen point forward. */
  recordRead(sessionId: string, read: SlackRead): void {
    const existing = this.find(sessionId, read.channelId, read.threadTs);
    const conversation: WatchedConversation = existing ?? {
      sessionId,
      channelId: read.channelId,
      ...(read.threadTs ? { threadTs: read.threadTs } : {}),
      label: read.label,
      seenTs: read.seenTs,
      lastReadAt: 0,
      pending: [],
      pendingOmitted: 0,
    };
    if (!existing) this.conversations.push(conversation);
    conversation.label = read.label || conversation.label;
    conversation.lastReadAt = this.now();
    conversation.threadKey = read.threadKey;
    conversation.questId = read.questId;
    markSeen(conversation, read.seenTs);
    this.persist();
  }

  /** Check every watched conversation once for new messages. */
  async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      this.dropFinished();
      const groups = new Map<string, WatchedConversation[]>();
      for (const conversation of this.conversations) {
        const key = `${conversation.channelId}|${conversation.threadTs ?? ""}`;
        groups.set(key, [...(groups.get(key) ?? []), conversation]);
      }
      if (groups.size === 0) return;
      const opened = await this.options.openReader();
      if (!opened.ok) {
        if (opened.reason !== this.lastUnavailableReason) this.log(`Not checking Slack: ${opened.reason}`);
        this.lastUnavailableReason = opened.reason;
        return;
      }
      this.lastUnavailableReason = null;
      try {
        for (const watchers of groups.values()) await this.check(opened.connection, watchers);
      } finally {
        await opened.connection.close().catch(() => {});
      }
      this.persist();
    } finally {
      this.polling = false;
    }
  }

  /** New messages waiting for the session, and how to mark them told once its input was accepted. */
  takeUpdates(sessionId: string): {
    updates: (SlackUpdate & { questId?: string })[];
    accept: () => void;
  } | null {
    const ready = this.conversations.filter((c) => c.sessionId === sessionId && c.pendingLatestTs);
    if (ready.length === 0) return null;
    const told = ready.map((conversation) => ({
      conversation,
      latestTs: conversation.pendingLatestTs!,
    }));
    return {
      updates: ready.map((conversation) => ({
        channelId: conversation.channelId,
        ...(conversation.threadTs ? { threadTs: conversation.threadTs } : {}),
        label: conversation.label,
        messages: [...conversation.pending],
        omitted: conversation.pendingOmitted,
        ...(conversation.threadKey ? { threadKey: conversation.threadKey } : {}),
        ...(conversation.questId ? { questId: conversation.questId } : {}),
      })),
      accept: () => {
        for (const { conversation, latestTs } of told) markSeen(conversation, latestTs);
        this.persist();
      },
    };
  }

  /** Wait for queued state writes; for tests. */
  flush(): Promise<void> {
    return this.pendingWrite;
  }

  private async check(connection: SlackReadConnection, watchers: WatchedConversation[]): Promise<void> {
    const { channelId, threadTs } = watchers[0]!;
    const oldest = watchers.map(newestKnown).sort(compareSlackTs)[0]!;
    let messages: SlackMessage[];
    try {
      messages = threadTs
        ? await connection.readThread(channelId, threadTs, oldest)
        : await connection.readChannel(channelId, oldest);
    } catch (error) {
      this.log(`Reading Slack conversation ${channelId} failed: ${error instanceof Error ? error.message : error}`);
      return;
    }
    const sorted = [...messages].sort((a, b) => compareSlackTs(a.ts, b.ts));
    for (const watcher of watchers) {
      for (const message of sorted) {
        if (compareSlackTs(message.ts, newestKnown(watcher)) <= 0) continue;
        const keptChars = watcher.pending.reduce((sum, kept) => sum + kept.text.length, 0);
        if (watcher.pendingOmitted === 0 && keptChars + message.text.length <= MESSAGE_TEXT_BUDGET) {
          watcher.pending.push(message);
        } else {
          watcher.pendingOmitted++;
        }
        watcher.pendingLatestTs = message.ts;
      }
    }
  }

  private dropFinished(): void {
    const now = this.now();
    this.conversations = this.conversations.filter(
      (c) => now - c.lastReadAt <= WATCH_WINDOW_MS && this.options.isSessionActive(c.sessionId),
    );
  }

  private find(sessionId: string, channelId: string, threadTs: string | undefined): WatchedConversation | undefined {
    return this.conversations.find(
      (c) => c.sessionId === sessionId && c.channelId === channelId && c.threadTs === threadTs,
    );
  }

  private persist(): void {
    const state = `${JSON.stringify({ conversations: this.conversations }, null, 2)}\n`;
    this.pendingWrite = this.pendingWrite
      .then(async () => {
        await mkdir(dirname(this.options.statePath), { recursive: true });
        await writeFile(this.options.statePath, state);
      })
      .catch((error) => this.log(`Saving ${this.options.statePath} failed: ${String(error)}`));
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private log(message: string): void {
    (this.options.log ?? console.log)(`[slack-updates] ${message}`);
  }
}

/**
 * The conversations a session read in these tool results. A thread read with
 * `slack_read_thread` counts; a `slack_read_channel` read counts only for a
 * direct-message conversation (`D…`) the session was sent a link into.
 */
export function slackReadsInToolResults(
  session: SessionLike,
  toolResults: readonly Extract<ContentBlock, { type: "tool_result" }>[],
): Omit<SlackRead, "threadKey" | "questId">[] {
  const reads: Omit<SlackRead, "threadKey" | "questId">[] = [];
  for (const result of toolResults) {
    if (result.is_error) continue;
    const toolUse = findToolUseBlockInHistory(session as never, result.tool_use_id);
    const kind = toolUse?.name.match(READ_TOOL)?.[1];
    const channelId = typeof toolUse?.input.channel_id === "string" ? toolUse.input.channel_id : "";
    if (!kind || !channelId) continue;
    const text = slackToolResultText(result.content);
    const messages = parseSlackMessages(text);
    const seenTs = messages
      .map((message) => message.ts)
      .sort(compareSlackTs)
      .at(-1);
    if (!seenTs) continue;
    if (kind === "thread") {
      const threadTs = typeof toolUse!.input.message_ts === "string" ? toolUse!.input.message_ts : "";
      if (!threadTs) continue;
      const parent = messages.find((message) => message.ts === threadTs);
      reads.push({
        channelId,
        threadTs,
        label: firstLine(parent?.text) || `thread ${threadTs}`,
        seenTs,
      });
      continue;
    }
    if (!channelId.startsWith("D") || !wasLinked(session, channelId)) continue;
    reads.push({
      channelId,
      label: parseSlackChannelName(text) ?? channelId,
      seenTs,
    });
  }
  return reads;
}

let activeWatch: SlackConversationWatch | null = null;

/** Load the saved watch and check Slack on a timer from now on. */
export async function startSlackConversationWatch(options: SlackConversationWatchOptions): Promise<void> {
  const watch = new SlackConversationWatch(options);
  await watch.load();
  watch.start();
  activeWatch = watch;
}

/** Record the Slack conversations read in a session's new tool results. */
export function recordSlackReads(
  session: SessionLike,
  toolResults: readonly Extract<ContentBlock, { type: "tool_result" }>[],
  route: { threadKey: string; questId?: string } | null,
): void {
  if (!activeWatch) return;
  for (const read of slackReadsInToolResults(session, toolResults)) {
    activeWatch.recordRead(session.id, {
      ...read,
      ...(route && route.threadKey !== "main" ? { threadKey: route.threadKey, questId: route.questId } : {}),
    });
  }
}

/**
 * Add the Slack updates waiting for a session to its input. Returns null when
 * there are none, or the input is one of Takode's own messages or carries
 * images (a delivery text would send those only as file paths); otherwise the
 * input to deliver, and `accept` to call once it was accepted.
 */
export function attachSlackUpdates(
  session: SessionLike,
  message: BrowserUserMessage,
): { message: BrowserUserMessage; accept: () => void } | null {
  if (!activeWatch || isSystemSourceId(message.agentSource?.sessionId) || message.imageRefs?.length) return null;
  const taken = activeWatch.takeUpdates(session.id);
  if (!taken) return null;
  const primary = normalizeAdapterUserMessage(session, message, undefined);
  if (primary?.type !== "user_message") return null;
  // One notice per leader thread, so each shows in the thread the conversation was read in.
  const byThread = new Map<string, typeof taken.updates>();
  for (const update of taken.updates) {
    const key = update.threadKey ?? "";
    byThread.set(key, [...(byThread.get(key) ?? []), update]);
  }
  const notices = [...byThread.values()].map((updates) => ({
    content: formatSlackUpdatesNotice(updates),
    agentSource: SLACK_UPDATES_SOURCE,
    ...(updates[0]!.threadKey ? { threadKey: updates[0]!.threadKey } : {}),
    ...(updates[0]!.questId ? { questId: updates[0]!.questId } : {}),
  }));
  return {
    message: {
      ...message,
      deliveryContent: [primary.content, ...notices.map((notice) => notice.content)].join("\n\n"),
      historyFollowUps: [...(message.historyFollowUps ?? []), ...notices],
    },
    accept: taken.accept,
  };
}

/** Clear the active watch between tests. */
export function resetSlackConversationWatchForTest(watch: SlackConversationWatch | null = null): void {
  activeWatch?.stop();
  activeWatch = watch;
}

function markSeen(conversation: WatchedConversation, ts: string): void {
  if (compareSlackTs(ts, conversation.seenTs) > 0) conversation.seenTs = ts;
  if (conversation.pendingLatestTs && compareSlackTs(conversation.pendingLatestTs, conversation.seenTs) <= 0) {
    conversation.pending = [];
    conversation.pendingOmitted = 0;
    delete conversation.pendingLatestTs;
    return;
  }
  conversation.pending = conversation.pending.filter((message) => compareSlackTs(message.ts, conversation.seenTs) > 0);
}

function newestKnown(conversation: WatchedConversation): string {
  return conversation.pendingLatestTs ?? conversation.seenTs;
}

function wasLinked(session: SessionLike, channelId: string): boolean {
  return session.messageHistory.some(
    (entry) =>
      entry.type === "user_message" &&
      typeof entry.content === "string" &&
      entry.content.includes(`/archives/${channelId}/`),
  );
}

function firstLine(text: string | undefined): string {
  const line =
    (text ?? "")
      .split("\n")
      .find((candidate) => candidate.trim() !== "")
      ?.trim() ?? "";
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}
