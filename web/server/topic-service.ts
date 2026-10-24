import type { BrowserIncomingMessage } from "./session-types.js";
import type { QuestmasterTask } from "./quest-types.js";
import { leaderMessageThreadKey } from "../shared/leader-thread-response-routing.js";
import { isActualHumanUserMessage } from "./user-message-classification.js";
import { isRootAgentHistoryMessage } from "./root-agent-feed-message.js";
import {
  STORYTELLER_BUDGET_SHARE,
  TOPIC_HINT_QUEST_COUNT,
  type TopicEvent,
  type TopicLeaderState,
  type TopicWriterStatus,
} from "../shared/library-topics.js";
import type { TopicStore } from "./topic-store.js";

/**
 * Keeps topic pages current, close to real time, with one topics writer per leader that has topics
 * on: a worker in that leader's herd. Events (its quests filed or finished, the user's messages in
 * those quests' tabs, artifacts saved there, fixes the user asked for) mark their topic changed for
 * that leader; about a minute after the first one, the leader's writer is asked to update the
 * changed topics, reading only its leader's new events. Topics stay shared across the session
 * space, so pages can hold several leaders' work. A writer's spend stays within a share of its
 * leader's own, and each leader's writer can be paused.
 */

export interface TopicSessionLike {
  id: string;
  messageHistory: BrowserIncomingMessage[];
  state: { treeGroupId?: string | null; isGenerating?: boolean };
}

export interface TopicLeaderInfo {
  sessionId: string;
  sessionNum: number | null;
  name: string;
  space: string;
  isOrchestrator: boolean;
  archived: boolean;
}

export interface TopicServiceDeps {
  getSession: (sessionId: string) => TopicSessionLike | undefined;
  getLeaderInfo: (sessionId: string) => TopicLeaderInfo | undefined;
  listLeaders: () => TopicLeaderInfo[];
  sessionNum: (sessionId: string) => number | null;
  /** The leader whose herd a session is in, or the session itself when it is a leader. */
  leaderOf: (sessionId: string) => string | undefined;
  listQuests: () => Promise<QuestmasterTask[]>;
  /** Sends text to a session as an injected message; false when it could not be delivered. */
  inject: (sessionId: string, text: string) => boolean;
  /** Starts a leader's topics writer as a worker in its herd; returns its session ID. */
  createWriter: (leader: TopicLeaderInfo) => Promise<string>;
  isWriterAlive: (sessionId: string) => boolean;
  /** Whether the writer is working on a turn now. */
  isWriterBusy: (sessionId: string) => boolean;
  /** About how many tokens the writer's conversation holds. */
  writerContextTokens: (sessionId: string) => number;
  /** Archives a writer (replaced, or its leader turned topics off). */
  retireWriter: (sessionId: string) => Promise<void>;
  /** The text of a message by session number and history index, or null when it can't be read. */
  messageText: (sessionNum: number, index: number) => string | null;
  /** Tells browsers the topics changed. */
  broadcastChanged: () => void;
  now?: () => number;
}

/** Events wait this long for more before the writer is asked. */
export const TOPIC_UPDATE_DELAY_MS = 60_000;
/** A request the writer hasn't answered is sent again after this long. */
const REQUEST_TIMEOUT_MS = 15 * 60_000;
const SPEND_WINDOW_MS = 24 * 60 * 60_000;
const BACKFILL_WINDOW_MS = 30 * 24 * 60 * 60_000;
/**
 * A writer whose conversation holds more than this is replaced before its next request: each update
 * needs only its brief and what is new, while a long conversation is reread (and paid for) on every
 * update.
 */
export const WRITER_CONTEXT_LIMIT = 100_000;
const EXCERPT_CHARS = 280;
const MAX_UNFILED_LISTED = 20;

interface WriterRequest {
  at: number;
  kind: "backfill" | "update";
  topics: string[];
}

export class TopicService {
  /** Per leader: the pending update timer. */
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Per leader: the request its writer has not answered with a page yet. */
  private requested = new Map<string, WriterRequest>();
  /** Per leader: the grouping instructions its Scribe was last told (their save time). */
  private notesTold = new Map<string, number>();
  private readonly now: () => number;

  constructor(
    readonly store: TopicStore,
    private readonly deps: TopicServiceDeps,
  ) {
    this.now = deps.now ?? Date.now;
  }

  // ─── Events ───────────────────────────────────────────────────────────────

  /** Reads new messages of a leader with topics on: the user's messages in a quest tab are events. */
  sessionSaved(sessionId: string): void {
    if (!this.store.loaded || !this.store.isLeaderEnabled(sessionId)) return;
    const session = this.deps.getSession(sessionId);
    if (!session) return;
    const history = session.messageHistory;
    const start = Math.min(this.store.cursorFor(sessionId) ?? history.length, history.length);
    for (let index = start; index < history.length; index += 1) {
      const message = history[index];
      if (!message || !isRootAgentHistoryMessage(message) || !isActualHumanUserMessage(message)) continue;
      const threadKey = leaderMessageThreadKey(message as Parameters<typeof leaderMessageThreadKey>[0]);
      if (!threadKey.startsWith("q-")) continue;
      const topic = this.store.topicOfQuest(threadKey);
      if (!topic) continue;
      const text = typeof message.content === "string" ? message.content : "";
      this.event(topic.id, sessionId, {
        at: typeof message.timestamp === "number" ? message.timestamp : this.now(),
        kind: "message",
        questId: threadKey,
        sessionId,
        messageIndex: index,
        text: excerpt(text),
      });
    }
    this.store.setCursor(sessionId, history.length);
    void this.store.flush();
  }

  /** A quest of a leader with topics on changed: finishing one is an event; one with no topic needs filing. */
  questChanged(quest: QuestmasterTask): void {
    if (!this.store.loaded) return;
    const leaderId = (quest as { leaderSessionId?: string }).leaderSessionId;
    if (!leaderId || !this.store.isLeaderEnabled(leaderId)) return;
    const topic = this.store.topicOfQuest(quest.questId);
    if (!topic) {
      if (quest.status !== "done") this.schedule(leaderId);
      return;
    }
    if (quest.status !== "done") return;
    const already = topic.events.some((event) => event.kind === "quest_done" && event.questId === quest.questId);
    if (already) return;
    this.event(topic.id, leaderId, { at: this.now(), kind: "quest_done", questId: quest.questId, text: quest.title });
    void this.store.flush();
  }

  /** A new artifact version saved in a quest's tab is an event for that quest's topic. */
  artifactSaved(input: { sessionId: string; threadKey: string; title: string; kind: string; version: number }): void {
    if (!this.store.loaded || !input.threadKey.startsWith("q-")) return;
    const topic = this.store.topicOfQuest(input.threadKey);
    const leaderId = this.deps.leaderOf(input.sessionId);
    if (!topic || !leaderId || !this.store.isLeaderEnabled(leaderId)) return;
    this.event(topic.id, leaderId, {
      at: this.now(),
      kind: "artifact",
      questId: input.threadKey,
      sessionId: input.sessionId,
      text: `${input.kind} "${input.title}"${input.version > 1 ? ` v${input.version}` : ""}`,
    });
    void this.store.flush();
  }

  /**
   * The user asked for a fix on a topic's page: it goes to the writer of the leader whose panel it
   * was asked from, or else of the enabled leader with the most quests under the topic.
   */
  async feedback(topicId: string, text: string, leaderId?: string): Promise<void> {
    const topic = this.store.resolve(topicId);
    if (!topic) return;
    const leader =
      leaderId && this.store.isLeaderEnabled(leaderId) ? leaderId : await this.leaderWithMostQuests(topic.id);
    if (!leader) return;
    this.store.addEvent(topic.id, { at: this.now(), kind: "feedback", leaderId: leader, text: excerpt(text, 2000) });
    void this.store.flush();
    void this.ask(leader, { force: true, topicId: topic.id });
  }

  /** The user undid a tidying change: the pages that describe it are told by the writers involved. */
  undone(space: string): void {
    for (const leader of this.enabledLeadersIn(space)) this.schedule(leader);
  }

  /** The user changed how to group a leader's topics: its writer hears about it on the next request. */
  notesChanged(leaderId: string): void {
    if (this.store.isLeaderEnabled(leaderId)) this.schedule(leaderId, 0);
  }

  /** Records an event for a leader's writer and schedules its update about a minute after the first. */
  event(topicId: string, leaderId: string, event: TopicEvent): void {
    this.store.addEvent(topicId, { ...event, leaderId });
    this.deps.broadcastChanged();
    this.schedule(leaderId);
  }

  schedule(leaderId: string, delay = TOPIC_UPDATE_DELAY_MS): void {
    if (this.timers.has(leaderId)) return;
    const timer = setTimeout(() => {
      this.timers.delete(leaderId);
      void this.ask(leaderId);
    }, delay);
    timer.unref?.();
    this.timers.set(leaderId, timer);
  }

  // ─── Asking the writer ────────────────────────────────────────────────────

  /**
   * Asks a leader's writer to update every topic with pending events of that leader, file its
   * unfiled quests and pass on changed grouping instructions. `force` (the user's Update now or a
   * fix request) skips the pause and the budget.
   */
  async ask(
    leaderId: string,
    options: { force?: boolean; topicId?: string } = {},
  ): Promise<"asked" | "nothing" | "paused" | "over_budget" | "busy" | "off"> {
    const leader = this.deps.getLeaderInfo(leaderId);
    if (!leader || !this.store.isLeaderEnabled(leaderId)) return "off";
    const topics = this.store
      .list(leader.space)
      .filter((topic) => !options.topicId || topic.id === options.topicId)
      .map((topic) => ({ topic, pending: this.store.pendingEvents(topic.id, leaderId).length }))
      .filter((entry) => entry.pending > 0);
    const folds = options.topicId ? [] : this.store.foldCandidates(leader.space);
    const unfiled = options.topicId ? [] : await this.unfiledQuests(leaderId);
    const notes = this.store.groupingNotes(leaderId);
    const notesChanged = !!notes && notes.updatedAt !== this.notesTold.get(leaderId);
    if (topics.length === 0 && folds.length === 0 && unfiled.length === 0 && !notesChanged) return "nothing";
    if (!options.force) {
      if (this.store.isPaused(leaderId)) return "paused";
      if (this.budget(leaderId).overBudget) return "over_budget";
      const pending = this.requested.get(leaderId);
      if (pending && this.now() - pending.at < REQUEST_TIMEOUT_MS) return "busy";
    }
    const writer = await this.ensureWriter(leader);
    const lines = [
      `Update the topic pages for leader #${leader.sessionNum ?? "?"}.`,
      ...(notesChanged
        ? ["", `The user's grouping instructions changed: "${notes!.text}". Re-file or tidy where they call for it.`]
        : []),
      ...(topics.length
        ? [
            "",
            ...topics.map(
              ({ topic, pending }) =>
                `- "${topic.name}" (${topic.id.slice(0, 8)}): ${pending} new event${pending === 1 ? "" : "s"}${topic.upToDateAt === null ? ", no page yet" : ""}.`,
            ),
            "Run `takode topic changes <topic>` for each.",
          ]
        : []),
      ...(unfiled.length
        ? [
            "",
            'Quests of your leader with no topic yet; file each (`takode topic set q-N "<topic>"`):',
            ...unfiled.map((quest) => `- ${quest.questId} ${quest.title}`),
          ]
        : []),
      ...(folds.length
        ? [
            "",
            "Tentative topics nothing joined in a day; fold each into a better topic if one fits (`takode topic merge <from> <into> --fold`), otherwise leave it:",
            ...folds.map((topic) => `- "${topic.name}" (${topic.id.slice(0, 8)})`),
          ]
        : []),
    ];
    if (!this.deps.inject(writer, lines.join("\n"))) return "busy";
    this.requested.set(leaderId, { at: this.now(), kind: "update", topics: topics.map(({ topic }) => topic.name) });
    if (notes) this.notesTold.set(leaderId, notes.updatedAt);
    this.deps.broadcastChanged();
    return "asked";
  }

  /** A writer saved a page: it answered, so the next events may ask again. */
  pageWritten(leaderId: string): void {
    this.requested.delete(leaderId);
    this.deps.broadcastChanged();
    // Events that arrived while the writer worked get their own update.
    const leader = this.deps.getLeaderInfo(leaderId);
    if (leader && this.store.list(leader.space).some((topic) => this.store.pendingEvents(topic.id, leaderId).length)) {
      this.schedule(leaderId);
    }
  }

  /**
   * Turns topics on or off for a leader. Turning on starts its writer, which first files the
   * leader's last month of quests; turning off archives the writer.
   */
  async setLeaderEnabled(sessionId: string, enabled: boolean): Promise<void> {
    const leader = this.deps.getLeaderInfo(sessionId);
    if (!leader?.isOrchestrator) throw new Error("Topics can be turned on only for leaders.");
    const { needsBackfill } = this.store.setLeaderEnabled(sessionId, enabled);
    const session = this.deps.getSession(sessionId);
    if (enabled && session) this.store.setCursor(sessionId, session.messageHistory.length);
    if (!enabled) {
      const writer = this.store.writerFor(sessionId);
      this.store.clearWriter(sessionId);
      this.requested.delete(sessionId);
      if (writer && this.deps.isWriterAlive(writer)) await this.deps.retireWriter(writer);
    }
    await this.store.flush();
    this.deps.broadcastChanged();
    if (!enabled) return;
    const writer = await this.ensureWriter(leader);
    if (!needsBackfill) return;
    const delivered = this.deps.inject(
      writer,
      [
        `Topics were turned on for your leader #${leader.sessionNum ?? "?"} "${leader.name}".`,
        "File its quests from the last 30 days into topics (`takode topic quests --unfiled` lists them), then write each topic's page.",
      ].join("\n"),
    );
    if (delivered) {
      this.store.markBackfilled(sessionId);
      this.requested.set(sessionId, { at: this.now(), kind: "backfill", topics: [] });
      const notes = this.store.groupingNotes(sessionId);
      if (notes) this.notesTold.set(sessionId, notes.updatedAt);
      await this.store.flush();
    }
  }

  /** Archives writers of the retired one-per-space design. */
  async retireLegacyWriters(): Promise<void> {
    const ids = this.store.takeLegacyWriters();
    await this.store.flush();
    for (const id of ids) {
      if (this.deps.isWriterAlive(id)) await this.deps.retireWriter(id);
    }
  }

  private async ensureWriter(leader: TopicLeaderInfo): Promise<string> {
    const existing = this.store.writerFor(leader.sessionId);
    if (existing && this.deps.isWriterAlive(existing)) {
      // Never replace a writer that may still be working on a request.
      if (this.requested.has(leader.sessionId) || this.deps.writerContextTokens(existing) <= WRITER_CONTEXT_LIMIT) {
        return existing;
      }
      this.store.recordRetiredSpend(
        leader.sessionId,
        sessionSpend(this.deps.getSession(existing), this.now() - SPEND_WINDOW_MS),
      );
      await this.deps.retireWriter(existing);
    }
    const sessionId = await this.deps.createWriter(leader);
    this.store.setWriter(leader.sessionId, sessionId);
    await this.store.flush();
    return sessionId;
  }

  // ─── Pages ────────────────────────────────────────────────────────────────

  /**
   * Quoted decisions that don't appear in the message they link to. A quote is text in double
   * quotes on the same line before a `session:N:index` link; ellipses may join separate parts.
   * Links to messages that can't be read are not checked.
   */
  checkQuotes(markdown: string): string[] {
    const problems: string[] = [];
    for (const line of markdown.split("\n")) {
      let segmentStart = 0;
      for (const link of line.matchAll(/\[[^\]]*\]\(session:(\d+):(\d+)\)/g)) {
        const segment = line.slice(segmentStart, link.index);
        segmentStart = (link.index ?? 0) + link[0].length;
        const quotes = [...segment.matchAll(/["\u201c]([^"\u201c\u201d]{3,})["\u201d]/g)].map((match) => match[1]);
        if (quotes.length === 0) continue;
        const text = this.deps.messageText(Number(link[1]), Number(link[2]));
        if (text === null) continue;
        const haystack = normalizeQuote(text);
        for (const quote of quotes) {
          const parts = quote
            .split(/\.\.\.|\u2026/)
            .map(normalizeQuote)
            .filter(Boolean);
          if (parts.every((part) => haystack.includes(part))) continue;
          problems.push(`"${quote}" is not in message session:${link[1]}:${link[2]}`);
        }
      }
    }
    return problems;
  }

  // ─── Status, budget and leader states ─────────────────────────────────────

  /** What a leader's writer is doing, in one line for the panel and `takode topic status`. */
  async status(leaderId: string): Promise<TopicWriterStatus> {
    const leader = this.deps.getLeaderInfo(leaderId);
    if (!leader || !this.store.isLeaderEnabled(leaderId)) return { state: "off", text: "Topics are off", pending: 0 };
    const writer = this.store.writerFor(leaderId);
    const alive = !!writer && this.deps.isWriterAlive(writer);
    const pending = this.store
      .list(leader.space)
      .reduce((sum, topic) => sum + this.store.pendingEvents(topic.id, leaderId).length, 0);
    const lastPageAt = this.store
      .list(leader.space)
      .filter((topic) => topic.questIds.length)
      .reduce<number | undefined>((latest, topic) => {
        const written = topic.upToDateAt ?? undefined;
        return written && (!latest || written > latest) ? written : latest;
      }, undefined);
    const base = {
      ...(alive ? { writerSessionId: writer, writerSessionNum: this.deps.sessionNum(writer!) } : {}),
      pending,
      ...(lastPageAt ? { lastPageAt } : {}),
    };
    if (!alive) return { state: "starting", text: "Starting the Scribe", ...base };
    const request = this.requested.get(leaderId);
    if (request?.kind === "backfill") {
      const { done, total } = await this.filingProgress(leaderId);
      if (done < total) {
        return { state: "filing", text: `Filing ${done} of ${total} quests`, progress: { done, total }, ...base };
      }
    }
    if (this.deps.isWriterBusy(writer!)) {
      const names = request?.topics ?? [];
      const text = names.length
        ? `Updating ${names.slice(0, 2).join(", ")}${names.length > 2 ? ` and ${names.length - 2} more` : ""}…`
        : "Working…";
      return { state: "updating", text, ...base };
    }
    if (this.store.isPaused(leaderId)) {
      return { state: "paused", text: pending ? `Paused · ${pending} updates waiting` : "Paused", ...base };
    }
    if (pending && this.budget(leaderId).overBudget) {
      return { state: "over_budget", text: `${pending} updates wait for budget`, ...base };
    }
    if (pending) return { state: "waiting", text: `${pending} update${pending === 1 ? "" : "s"} coming`, ...base };
    return { state: "idle", text: "Up to date", ...base };
  }

  /** A writer's spend over the last day against a share of its leader's spend. */
  budget(leaderId: string): { used: number; limit: number; overBudget: boolean } {
    const since = this.now() - SPEND_WINDOW_MS;
    const leaderSpend = sessionSpend(this.deps.getSession(leaderId), since);
    const writer = this.store.writerFor(leaderId);
    const used =
      (writer ? sessionSpend(this.deps.getSession(writer), since) : 0) + this.store.retiredSpend(leaderId, since);
    const limit = leaderSpend * STORYTELLER_BUDGET_SHARE;
    // With no measured leader spend yet (a fresh day or backend without usage), do not block the first updates.
    return { used, limit, overBudget: limit > 0 && used > limit };
  }

  async leaderStates(): Promise<TopicLeaderState[]> {
    const quests = await this.deps.listQuests();
    const counts = new Map<string, number>();
    for (const quest of quests) {
      const leaderId = (quest as { leaderSessionId?: string }).leaderSessionId;
      if (leaderId) counts.set(leaderId, (counts.get(leaderId) ?? 0) + 1);
    }
    return this.deps
      .listLeaders()
      .filter((leader) => !leader.archived)
      .map((leader) => {
        const enabled = this.store.isLeaderEnabled(leader.sessionId);
        const questCount = counts.get(leader.sessionId) ?? 0;
        return {
          sessionId: leader.sessionId,
          sessionNum: leader.sessionNum,
          name: leader.name,
          space: leader.space,
          enabled,
          questCount,
          suggest: !enabled && questCount >= TOPIC_HINT_QUEST_COUNT && !this.store.hintDismissed(leader.sessionId),
        };
      });
  }

  /** A leader's quests of the backfill month (or since topics were turned on) with no topic. */
  async unfiledQuests(leaderId: string): Promise<QuestmasterTask[]> {
    return (await this.leaderRecentQuests(leaderId))
      .filter((quest) => !this.store.topicOfQuest(quest.questId))
      .slice(0, MAX_UNFILED_LISTED);
  }

  private async filingProgress(leaderId: string): Promise<{ done: number; total: number }> {
    const quests = await this.leaderRecentQuests(leaderId);
    return { done: quests.filter((quest) => this.store.topicOfQuest(quest.questId)).length, total: quests.length };
  }

  private async leaderRecentQuests(leaderId: string): Promise<QuestmasterTask[]> {
    const since = this.now() - BACKFILL_WINDOW_MS;
    return (await this.deps.listQuests())
      .filter((quest) => (quest as { leaderSessionId?: string }).leaderSessionId === leaderId)
      .filter((quest) => quest.createdAt >= since)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  private enabledLeadersIn(space: string): string[] {
    return this.store.enabledLeaderIds().filter((leaderId) => this.deps.getLeaderInfo(leaderId)?.space === space);
  }

  private async leaderWithMostQuests(topicId: string): Promise<string | undefined> {
    const questIds = new Set(this.store.questsOf(topicId));
    const counts = new Map<string, number>();
    for (const quest of await this.deps.listQuests()) {
      const leaderId = (quest as { leaderSessionId?: string }).leaderSessionId;
      if (!questIds.has(quest.questId) || !leaderId || !this.store.isLeaderEnabled(leaderId)) continue;
      counts.set(leaderId, (counts.get(leaderId) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  }
}

/** Text compared for the quote check: no markdown, quotes or dashes of different shapes, or spacing. */
function normalizeQuote(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Spend of a session since a time, from its turns' token usage, weighted roughly like Claude's
 * prices (cache reads cheap, output dear), so leaders and the page writer compare fairly.
 */
export function sessionSpend(session: TopicSessionLike | undefined, since: number): number {
  if (!session) return 0;
  let spend = 0;
  // Results carry no time of their own: walking back, a result counts once its turn's earlier
  // timed message is found inside the window.
  let unplaced = 0;
  for (let index = session.messageHistory.length - 1; index >= 0; index -= 1) {
    const message = session.messageHistory[index] as { type?: string; timestamp?: number; data?: { usage?: Usage } };
    if (message.type === "result" && message.data?.usage) unplaced += weightedTokens(message.data.usage);
    if (typeof message.timestamp !== "number") continue;
    if (message.timestamp < since) return spend;
    spend += unplaced;
    unplaced = 0;
  }
  return spend + unplaced;
}

interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export function weightedTokens(usage: Usage): number {
  return (
    (usage.input_tokens ?? 0) +
    1.25 * (usage.cache_creation_input_tokens ?? 0) +
    0.1 * (usage.cache_read_input_tokens ?? 0) +
    5 * (usage.output_tokens ?? 0)
  );
}

function excerpt(text: string, limit = EXCERPT_CHARS): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > limit ? `${clean.slice(0, limit - 1).trimEnd()}…` : clean;
}
