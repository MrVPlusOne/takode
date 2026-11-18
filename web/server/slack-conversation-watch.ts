import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { isSystemSourceId } from "../shared/injected-event-message.js";
import {
  compareSlackTs,
  formatSlackUpdatesNotice,
  parseSlackChannelName,
  parseSlackMessages,
  SLACK_UPDATES_SOURCE,
  slackConversationId,
  slackToolResultPagination,
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
 * for this. A session watches at most the 10 conversations it read most
 * recently, each until 3 days after it last read it.
 *
 * A session watches a thread it read with `slack_read_thread`, and a direct
 * or group message conversation it read with `slack_read_channel` after it was
 * sent a link into it. Other channel reads, such as a briefing scanning
 * channels, start nothing: the session reads those itself whenever it needs them.
 *
 * Besides the regular check, the user starting to write to a session (or
 * opening its question card) checks that session's conversations, so the
 * updates riding on what they send are fresh.
 */

const POLL_INTERVAL_MS = 10 * 60_000;
/** A conversation checked this recently is not checked again when the user writes to its session. */
const REFRESH_MIN_AGE_MS = 60_000;
const WATCH_WINDOW_MS = 3 * 24 * 60 * 60_000;
/** A session watches only the conversations it read most recently. */
const MAX_WATCHED_PER_SESSION = 10;
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
  /** When the session last read the conversation or was sent a link to it. */
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
  /** A notice has named this conversation to the session, so later ones only carry its ID. */
  introduced?: boolean;
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
  /** When each conversation (`conversationKey`) was last checked, and which checks are under way. */
  private checkedAt = new Map<string, number>();
  private checking = new Set<string>();
  private lastUnavailableReason: string | null = null;
  /**
   * The web address of the Slack workspace the login reads, for the "Open in
   * Slack" links people see. One login reads one workspace (or one Enterprise
   * Grid organization, whose address opens any of its conversations), so it is
   * learned once per run.
   */
  private linkOrigin: string | null = null;
  /** Looked for at most once per poll interval, so a failing search does not add a read to every check. */
  private linkOriginTriedAt = -Infinity;

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
    markSeen(this.watch(sessionId, read), read.seenTs);
    this.persist();
  }

  /**
   * The user sent the session links to Slack conversations in a message at
   * `sentAt`: watch each direct message, group DM and thread linked, from that
   * moment, whether the session reads it itself or has a worker do it. A link
   * to a conversation it already watches only renews the watch, since a link
   * does not mean the session saw the messages waiting for it.
   */
  async recordLinks(
    sessionId: string,
    text: string,
    sentAt: number,
    route: { threadKey?: string; questId?: string } = {},
  ): Promise<void> {
    const links = slackLinksIn(text);
    if (links.length === 0) return;
    const seenTs = `${Math.floor(sentAt / 1000)}.000000`;
    const opened = await this.options.openReader();
    const connection = opened.ok ? opened.connection : null;
    if (!opened.ok) this.log(`Not looking up linked Slack conversations: ${opened.reason}`);
    try {
      for (const link of links) {
        const targets = await linkedConversations(connection, link, seenTs).catch((error: unknown) => {
          this.log(`Looking up linked Slack conversation ${link.channelId} failed: ${String(error)}`);
          return linkedConversations(null, link, seenTs);
        });
        for (const target of targets) this.watch(sessionId, { ...target, seenTs, ...route });
      }
    } finally {
      await connection?.close().catch(() => {});
    }
    this.persist();
  }

  /** The conversations a session watches, most recently read or linked first. */
  watched(sessionId: string): { id: string; label: string; lastReadAt: number }[] {
    return this.conversations
      .filter((c) => c.sessionId === sessionId)
      .sort((a, b) => b.lastReadAt - a.lastReadAt)
      .map((c) => ({ id: slackConversationId(c), label: c.label, lastReadAt: c.lastReadAt }));
  }

  /** Stop watching these conversations (by the ID notices show) for the session, or all of them; returns the IDs stopped. */
  unwatch(sessionId: string, ids: readonly string[] | "all"): string[] {
    const stopped = this.conversations.filter(
      (c) => c.sessionId === sessionId && (ids === "all" || ids.includes(slackConversationId(c))),
    );
    if (stopped.length === 0) return [];
    this.conversations = this.conversations.filter((c) => !stopped.includes(c));
    this.persist();
    return stopped.map(slackConversationId);
  }

  /** Check every watched conversation once for new messages. */
  poll(): Promise<void> {
    this.dropFinished();
    return this.checkConversations(this.conversations);
  }

  /**
   * The user is writing to this session: check the conversations it watches
   * that were not checked in the last minute, so its next input carries fresh
   * updates. Typing calls this often; within a minute it reads nothing.
   */
  refresh(sessionId: string): Promise<void> {
    this.dropFinished();
    const now = this.now();
    return this.checkConversations(
      this.conversations.filter(
        (c) =>
          c.sessionId === sessionId &&
          now - (this.checkedAt.get(conversationKey(c)) ?? -Infinity) >= REFRESH_MIN_AGE_MS,
      ),
    );
  }

  /** New messages waiting for the session, and how to mark them told once its input was accepted. */
  takeUpdates(sessionId: string): {
    updates: (SlackUpdate & { questId?: string })[];
    /** The session has had no notice yet (among the conversations it watches): explain the format. */
    explain: boolean;
    /** The Slack workspace's web address, once known, for links in the copy people see. */
    linkOrigin?: string;
    accept: () => void;
  } | null {
    const ready = this.conversations.filter((c) => c.sessionId === sessionId && c.pendingLatestTs);
    if (ready.length === 0) return null;
    const explain = !this.conversations.some((c) => c.sessionId === sessionId && c.introduced);
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
        introduce: !conversation.introduced,
      })),
      explain,
      ...(this.linkOrigin ? { linkOrigin: this.linkOrigin } : {}),
      accept: () => {
        for (const { conversation, latestTs } of told) {
          markSeen(conversation, latestTs);
          conversation.introduced = true;
        }
        this.persist();
      },
    };
  }

  /** Wait for queued state writes; for tests. */
  flush(): Promise<void> {
    return this.pendingWrite;
  }

  /** Read each of these conversations once, for every session watching it, unless it is being read already. */
  private async checkConversations(conversations: readonly WatchedConversation[]): Promise<void> {
    const keys = [...new Set(conversations.map(conversationKey))].filter((key) => !this.checking.has(key));
    if (keys.length === 0) return;
    // Marked checked at the start, so typing does not retry a minute's worth while Slack is unreachable.
    const now = this.now();
    for (const key of keys) {
      this.checking.add(key);
      this.checkedAt.set(key, now);
    }
    try {
      const opened = await this.options.openReader();
      if (!opened.ok) {
        if (opened.reason !== this.lastUnavailableReason) this.log(`Not checking Slack: ${opened.reason}`);
        this.lastUnavailableReason = opened.reason;
        return;
      }
      this.lastUnavailableReason = null;
      try {
        if (!this.linkOrigin && now - this.linkOriginTriedAt >= POLL_INTERVAL_MS) {
          this.linkOriginTriedAt = now;
          await this.learnLinkOrigin(opened.connection, keys[0]!.split("|")[0]!);
        }
        for (const key of keys) {
          // Looked up now, so a session that started watching meanwhile is included.
          const watchers = this.conversations.filter((c) => conversationKey(c) === key);
          if (watchers.length > 0) await this.check(opened.connection, watchers);
        }
      } finally {
        await opened.connection.close().catch(() => {});
      }
      this.persist();
    } finally {
      for (const key of keys) this.checking.delete(key);
    }
  }

  private async learnLinkOrigin(connection: SlackReadConnection, channelId: string): Promise<void> {
    try {
      this.linkOrigin = await connection.readLinkOrigin(channelId);
    } catch (error) {
      this.log(`Finding Slack's web address failed: ${error instanceof Error ? error.message : error}`);
    }
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
    const watched = new Set(this.conversations.map(conversationKey));
    for (const key of this.checkedAt.keys()) if (!watched.has(key)) this.checkedAt.delete(key);
  }

  /**
   * Watch a conversation for the session, or renew its watch, keeping the
   * session within its most recent conversations; the seen point is the caller's.
   */
  private watch(sessionId: string, read: SlackRead): WatchedConversation {
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
    const others = this.conversations
      .filter((c) => c.sessionId === sessionId && c !== conversation)
      .sort((a, b) => b.lastReadAt - a.lastReadAt);
    const dropped = new Set(others.slice(MAX_WATCHED_PER_SESSION - 1));
    if (dropped.size > 0) this.conversations = this.conversations.filter((c) => !dropped.has(c));
    return conversation;
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
 * The conversations a session read in these tool results, `readAt` being when
 * it read them. A thread read with `slack_read_thread` counts; a
 * `slack_read_channel` read counts only for a direct or group message
 * conversation the session was sent a link into.
 */
export function slackReadsInToolResults(
  session: SessionLike,
  toolResults: readonly Extract<ContentBlock, { type: "tool_result" }>[],
  readAt = Date.now(),
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
    const seenTs =
      messages
        .map((message) => message.ts)
        .sort(compareSlackTs)
        .at(-1) ?? seenByReadTime(toolUse!.input, result.content, readAt);
    if (!seenTs) continue;
    if (kind === "thread") {
      const threadTs = typeof toolUse!.input.message_ts === "string" ? toolUse!.input.message_ts : "";
      if (!threadTs) continue;
      const parent = messages.find((message) => message.ts === threadTs);
      reads.push({
        channelId,
        threadTs,
        // A concise read prints the first message as `THREAD: <text> [<author>]`.
        label: firstLine(parent?.text ?? text.match(/^THREAD: (.*?)(?: \[[^\]]*\])?$/m)?.[1]) || `thread ${threadTs}`,
        seenTs,
      });
      continue;
    }
    const directOrGroup = /^[DG]/.test(channelId) || parseSlackChannelName(text) === "Group DM";
    if (!directOrGroup || !wasLinked(session, channelId)) continue;
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
 * Watch the Slack conversations the user linked in a message to this session,
 * from now. Only the user's own messages count: a leader's or Takode's
 * messages start a watch only once the session reads the conversation.
 */
export function recordSlackLinks(session: SessionLike, message: BrowserUserMessage): void {
  if (!activeWatch || message.agentSource || typeof message.content !== "string") return;
  const route =
    message.threadKey && message.threadKey !== "main" ? { threadKey: message.threadKey, questId: message.questId } : {};
  void activeWatch.recordLinks(session.id, message.content, Date.now(), route);
}

/** The conversations a session watches; empty when Slack updates are off. */
export function watchedSlackConversations(sessionId: string): ReturnType<SlackConversationWatch["watched"]> {
  return activeWatch?.watched(sessionId) ?? [];
}

/** Stop watching conversations for a session (see `SlackConversationWatch.unwatch`). */
export function stopWatchingSlack(sessionId: string, ids: readonly string[] | "all"): string[] {
  return activeWatch?.unwatch(sessionId, ids) ?? [];
}

/** The user is writing to this session (or opened its question card): check its conversations now. */
export function refreshSlackUpdates(sessionId: string): void {
  void activeWatch?.refresh(sessionId);
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
  // The format is explained once, in the first notice. The feed's copy also links each conversation in Slack.
  const groups = [...byThread.values()].map((updates, index) => ({ updates, explain: taken.explain && index === 0 }));
  const notices = groups.map(({ updates, explain }) => ({
    content: formatSlackUpdatesNotice(updates, { explain, linkOrigin: taken.linkOrigin }),
    agentSource: SLACK_UPDATES_SOURCE,
    ...(updates[0]!.threadKey ? { threadKey: updates[0]!.threadKey } : {}),
    ...(updates[0]!.questId ? { questId: updates[0]!.questId } : {}),
  }));
  return {
    message: {
      ...message,
      deliveryContent: [
        primary.content,
        ...groups.map(({ updates, explain }) => formatSlackUpdatesNotice(updates, { explain })),
      ].join("\n\n"),
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

interface SlackLink {
  channelId: string;
  /** The linked message, when the link points at one. */
  messageTs?: string;
  /** The thread the linked message is a reply in. */
  threadTs?: string;
}

/** Links to Slack conversations or messages (`…slack.com/archives/<id>[/p<ts>][?thread_ts=…]`) in a text. */
function slackLinksIn(text: string): SlackLink[] {
  const links = new Map<string, SlackLink>();
  for (const match of text.matchAll(
    /https?:\/\/[\w.-]*slack\.com\/archives\/([A-Z0-9]+)(?:\/p(\d{10})(\d{6}))?(\?[^\s)>\]|]*)?/g,
  )) {
    const [, channelId, seconds, fraction, query] = match;
    const threadTs = query?.match(/[?&]thread_ts=(\d+\.\d+)/)?.[1];
    const link: SlackLink = {
      channelId: channelId!,
      ...(seconds ? { messageTs: `${seconds}.${fraction}` } : {}),
      ...(threadTs ? { threadTs } : {}),
    };
    links.set(`${link.channelId}|${link.threadTs ?? link.messageTs ?? ""}`, link);
  }
  return [...links.values()];
}

/**
 * The conversations a link asks to watch: the thread the linked message starts
 * or belongs to, and the whole conversation when it is a direct message or
 * group DM; nothing for a link to a whole channel. Group DMs have `C…` IDs like
 * channels, so without Slack a `C…` link is taken for a channel.
 */
async function linkedConversations(
  connection: SlackReadConnection | null,
  link: SlackLink,
  sinceTs: string,
): Promise<{ channelId: string; threadTs?: string; label: string }[]> {
  const { channelId } = link;
  const watched: { channelId: string; threadTs?: string; label: string }[] = [];
  const name = /^[DG]/.test(channelId) || !connection ? null : await connection.readChannelName(channelId);
  if (/^[DG]/.test(channelId) || name === "Group DM") {
    watched.push({ channelId, label: name ?? (channelId.startsWith("D") ? "DM" : "Group DM") });
  }
  const threadTs = link.threadTs ?? link.messageTs;
  if (threadTs) {
    // Slack returns the thread's first message along with replies newer than `oldest`.
    const read = connection ? await connection.readThread(channelId, threadTs, sinceTs) : [];
    const parent = read.find((message) => message.ts === threadTs);
    watched.push({ channelId, threadTs, label: firstLine(parent?.text) || `thread ${threadTs}` });
  }
  return watched;
}

function conversationKey(conversation: Pick<WatchedConversation, "channelId" | "threadTs">): string {
  return `${conversation.channelId}|${conversation.threadTs ?? ""}`;
}

/**
 * How far a read saw when its result shows no message timestamps, as with
 * `response_format: "concise"`: up to when it was read, unless it showed an
 * older part of the conversation (`latest`, a later page) or left out newer
 * thread replies.
 */
function seenByReadTime(input: Record<string, unknown>, content: unknown, readAt: number): string | undefined {
  if (input.latest !== undefined || input.cursor !== undefined) return undefined;
  // Not "There are no more messages in this thread.", which ends every complete read.
  if (/^There are more messages in this thread/i.test(slackToolResultPagination(content).trim())) return undefined;
  return `${Math.floor(readAt / 1000)}.000000`;
}

function newestKnown(conversation: WatchedConversation): string {
  return conversation.pendingLatestTs ?? conversation.seenTs;
}

/**
 * Whether the session was sent a link to the conversation or one of its messages
 * (`/archives/<id>` or `/archives/<id>/p…`) in a message, such as a worker its
 * leader sent the link to. A link only in a quest's text does not count.
 */
function wasLinked(session: SessionLike, channelId: string): boolean {
  if (!/^[A-Z0-9]+$/.test(channelId)) return false;
  const link = new RegExp(`/archives/${channelId}(?![A-Z0-9])`);
  return session.messageHistory.some(
    (entry) => entry.type === "user_message" && typeof entry.content === "string" && link.test(entry.content),
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
