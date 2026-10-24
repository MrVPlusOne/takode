import type { BrowserIncomingMessage } from "./session-types.js";
import type { QuestmasterTask } from "./quest-types.js";
import { leaderMessageThreadKey } from "../shared/leader-thread-response-routing.js";
import { isActualHumanUserMessage } from "./user-message-classification.js";
import { isRootAgentHistoryMessage } from "./root-agent-feed-message.js";
import { formatAnnotatedMessage } from "../shared/conversation-annotations.js";
import {
  SCRIBE_BUDGET_SHARE,
  TOPIC_HINT_QUEST_COUNT,
  type TopicEvent,
  type TopicLeaderState,
  type ScribeActivity,
  type ScribeOverview,
} from "../shared/library-topics.js";
import type { TopicStore } from "./topic-store.js";
import { initializationMessage, leaderNotice, reminderMessage, updateMessage } from "./scribe-messages.js";

/**
 * Keeps topic pages current with one Scribe per leader that has topics on: a worker in that
 * leader's herd, running continuously like any worker. Events (the leader's quests put under a
 * topic or finished, the user's messages in those quests' tabs, artifacts saved there, changes
 * the user undid) are recorded on their topics. Whenever its Scribe is
 * idle, Takode sends it one message with everything that changed for its leader since the last
 * one; while it works, new events wait for its turn to end. If it stops with work of a message
 * left, it gets one reminder, and then its leader is told. Topics stay shared across the session
 * space, so pages can hold several leaders' work. A Scribe's spend stays within a share of its
 * leader's own, and the user can pause it.
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
  /** The leader's backend; its Scribe uses the same one unless Settings name another. */
  backendType?: string;
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
  /** Starts a leader's Scribe as a worker in its herd; returns its session ID. */
  createScribe: (leader: TopicLeaderInfo) => Promise<string>;
  isScribeAlive: (sessionId: string) => boolean;
  /** Whether the Scribe is working on a turn now. */
  isScribeBusy: (sessionId: string) => boolean;
  /** Archives a Scribe (its leader turned topics off). */
  retireScribe: (sessionId: string) => Promise<void>;
  /** Tells a leader something about its Scribe that needs it. */
  notifyLeader: (leaderId: string, text: string) => void;
  /** The text of a message by session number and history index, or null when it can't be read. */
  messageText: (sessionNum: number, index: number) => string | null;
  /** Tells browsers the topics changed. */
  broadcastChanged: () => void;
  now?: () => number;
}

/** A message whose turn never ended stops blocking the next one after this long. */
const STALE_DELIVERY_MS = 15 * 60_000;
const SPEND_WINDOW_MS = 24 * 60 * 60_000;
/** Initialization sorts the leader's quests of this window. */
const RECENT_WINDOW_MS = 30 * 24 * 60 * 60_000;
const EXCERPT_CHARS = 280;

/** The page format the brief describes; Scribes whose pages are older are asked once to rewrite them. */
export const PAGE_FORMAT = 3;

export type DeliveryResult = "sent" | "nothing" | "paused" | "over_budget" | "busy" | "off";

/** A message the Scribe got and has not finished a turn on yet. */
interface Delivery {
  sentAt: number;
  purpose: "initialize" | "update";
  /** Events up to this sequence number were in it. */
  throughSeq: number;
  topics: string[];
  reminded: boolean;
}

export class TopicService {
  /** Per leader: the message its Scribe is working on, until a turn of the Scribe ends. */
  private awaiting = new Map<string, Delivery>();
  /** Per leader: topics the user asked to have updated now, sent with the next message. */
  private forced = new Map<string, Set<string>>();
  /** Per leader: deliveries run one at a time, so two events never send two messages. */
  private chains = new Map<string, Promise<unknown>>();
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
    let recorded = false;
    for (let index = start; index < history.length; index += 1) {
      const message = history[index];
      if (!message || !isRootAgentHistoryMessage(message) || !isActualHumanUserMessage(message)) continue;
      const threadKey = leaderMessageThreadKey(message as Parameters<typeof leaderMessageThreadKey>[0]);
      if (!threadKey.startsWith("q-")) continue;
      const topic = this.store.topicOfQuest(threadKey);
      if (!topic) continue;
      // A comment-only message has its words in its comments.
      const text = formatAnnotatedMessage(
        typeof message.content === "string" ? message.content : "",
        "annotations" in message ? message.annotations : undefined,
      );
      this.store.addEvent(topic.id, {
        at: typeof message.timestamp === "number" ? message.timestamp : this.now(),
        kind: "message",
        leaderId: sessionId,
        questId: threadKey,
        sessionId,
        messageIndex: index,
        text: excerpt(text),
      });
      recorded = true;
    }
    this.store.setCursor(sessionId, history.length);
    void this.store.flush();
    if (recorded) this.changed(sessionId);
  }

  /** A quest of a leader with topics on changed: finishing one is an event; a new one may need a topic. */
  questChanged(quest: QuestmasterTask): void {
    if (!this.store.loaded) return;
    const leaderId = (quest as { leaderSessionId?: string }).leaderSessionId;
    if (!leaderId || !this.store.isLeaderEnabled(leaderId)) return;
    const topic = this.store.topicOfQuest(quest.questId);
    if (!topic) {
      if (quest.status !== "done") this.changed(leaderId);
      return;
    }
    if (quest.status !== "done") return;
    const already = topic.events.some((event) => event.kind === "quest_done" && event.questId === quest.questId);
    if (already) return;
    // Checks the quest left for the user are often what the page's Now needs.
    const checks = (
      (quest as { verificationItems?: Array<{ text: string; checked: boolean }> }).verificationItems ?? []
    )
      .filter((item) => !item.checked)
      .map((item) => item.text);
    this.event(topic.id, leaderId, {
      at: this.now(),
      kind: "quest_done",
      questId: quest.questId,
      text: excerpt(checks.length ? `${quest.title} · left for the user: ${checks.join("; ")}` : quest.title, 600),
    });
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
  }

  /** Update now: the topic goes to the leader's Scribe with its next message, paused or not. */
  requestUpdate(leaderId: string, topicId: string): Promise<DeliveryResult> {
    const forced = this.forced.get(leaderId) ?? new Set<string>();
    forced.add(topicId);
    this.forced.set(leaderId, forced);
    return this.deliver(leaderId);
  }

  /** The user undid a tidying change: the Scribes of the space hear about it. */
  undone(space: string): void {
    for (const leader of this.enabledLeadersIn(space)) this.changed(leader);
  }

  /** Something the leader's Scribe should hear about changed (instructions, a resume, a filing). */
  changed(leaderId: string): void {
    if (this.store.isLeaderEnabled(leaderId)) void this.deliver(leaderId);
  }

  /** Records an event for a leader's Scribe and sends it as soon as the Scribe is idle. */
  event(topicId: string, leaderId: string, event: TopicEvent): void {
    this.store.addEvent(topicId, { ...event, leaderId });
    void this.store.flush();
    this.deps.broadcastChanged();
    this.changed(leaderId);
  }

  // ─── Messages to the Scribe ───────────────────────────────────────────────

  /**
   * Sends the leader's Scribe what changed since its last message, if it is idle; otherwise the
   * changes wait for its turn to end. A topic the user asked to update now goes even when paused
   * or over budget.
   */
  deliver(leaderId: string): Promise<DeliveryResult> {
    const previous = this.chains.get(leaderId) ?? Promise.resolve();
    const next = previous.then(
      () => this.deliverNow(leaderId),
      () => this.deliverNow(leaderId),
    );
    this.chains.set(leaderId, next);
    return next;
  }

  private async deliverNow(leaderId: string): Promise<DeliveryResult> {
    const leader = this.deps.getLeaderInfo(leaderId);
    if (!leader || !this.store.isLeaderEnabled(leaderId)) return "off";
    const forcedIds = [...(this.forced.get(leaderId) ?? [])];
    if (!forcedIds.length) {
      if (this.store.isScribePaused(leaderId)) return "paused";
      if (this.budget(leaderId).overBudget) return "over_budget";
    }
    const current = this.store.scribeSession(leaderId);
    if (current && this.deps.isScribeAlive(current) && this.isWorking(leaderId, current)) return "busy";
    const scribe = await this.ensureScribe(leader);
    const instructions = this.store.scribeInstructions(leaderId);
    const sendInstructions = !this.store.instructionsSent(leaderId);
    const recent = await this.leaderQuests(leaderId, this.now() - RECENT_WINDOW_MS);
    // Events recorded from here on are not in this message.
    const throughSeq = this.store.eventSeq();

    if (this.store.needsInitialization(leaderId)) {
      const text = initializationMessage(leader, instructions?.text);
      if (!this.deps.inject(scribe, text)) return "busy";
      this.store.markInitialized(leaderId);
      this.store.markInstructionsSent(leaderId);
      this.store.setPageFormat(leaderId, PAGE_FORMAT);
      // Initialization covers the recent quests and whatever happened before it.
      this.store.markDelivered(
        leaderId,
        throughSeq,
        recent.map((quest) => quest.questId),
      );
      this.awaiting.set(leaderId, {
        sentAt: this.now(),
        purpose: "initialize",
        throughSeq,
        topics: [],
        reminded: false,
      });
      // Topics the user asked to update go with the next message, after initialization.
      return this.sent();
    }

    const since = this.store.deliveredSeq(leaderId);
    const ownQuests = await this.leaderQuestIds(leaderId);
    const isNew = (event: TopicEvent) => (event.seq ?? 0) > since && (event.seq ?? 0) <= throughSeq;
    const topics = this.store
      .list(leader.space)
      .map((summary) => {
        const events = this.store
          .detail(summary.id)
          .events.filter(
            (event) =>
              isNew(event) &&
              !event.byScribe &&
              (event.leaderId === leaderId || (!event.leaderId && summary.questIds.some((id) => ownQuests.has(id)))),
          );
        return { id: summary.id, name: summary.name, events };
      })
      .filter((topic) => topic.events.length);
    const forcedNames = forcedIds.flatMap((id) => {
      const topic = this.store.resolve(id);
      return topic ? [topic.name] : [];
    });
    const told = this.store.questsTold(leaderId);
    const unsorted = recent.filter(
      (quest) => quest.status !== "done" && !this.store.topicOfQuest(quest.questId) && !told.has(quest.questId),
    );
    const rewritePages = this.store.pageFormat(leaderId) < PAGE_FORMAT;
    const text = updateMessage(
      leader,
      {
        topics,
        unsorted,
        rewritePages,
        ...(sendInstructions && instructions ? { instructions: instructions.text } : {}),
        forced: forcedNames,
      },
      (sessionId) => this.deps.sessionNum(sessionId),
    );
    this.forced.delete(leaderId);
    if (!text) return "nothing";
    if (!this.deps.inject(scribe, text)) return "busy";
    this.store.markDelivered(
      leaderId,
      throughSeq,
      unsorted.map((quest) => quest.questId),
    );
    this.store.markInstructionsSent(leaderId);
    if (rewritePages) this.store.setPageFormat(leaderId, PAGE_FORMAT);
    const names = rewritePages
      ? this.store
          .list(leader.space)
          .filter((topic) => topic.questIds.some((id) => ownQuests.has(id)))
          .map((topic) => topic.name)
      : [...new Set([...forcedNames, ...topics.map((topic) => topic.name)])];
    this.awaiting.set(leaderId, { sentAt: this.now(), purpose: "update", throughSeq, topics: names, reminded: false });
    return this.sent();
  }

  private sent(): DeliveryResult {
    void this.store.flush();
    this.deps.broadcastChanged();
    return "sent";
  }

  /** A Scribe works while its turn runs, or until a turn ends after the last message it got. */
  private isWorking(leaderId: string, scribe: string): boolean {
    if (this.deps.isScribeBusy(scribe)) return true;
    const delivery = this.awaiting.get(leaderId);
    return !!delivery && this.now() - delivery.sentAt < STALE_DELIVERY_MS;
  }

  /** A page was saved: the panels show it. */
  pageSaved(): void {
    this.deps.broadcastChanged();
  }

  /**
   * A Scribe ended a turn. If work of its last message is left, it gets one reminder; if it
   * stops again with work left, its leader is told. Then whatever changed meanwhile is sent.
   */
  async scribeTurnEnded(sessionId: string): Promise<void> {
    const leaderId = this.store.leaderOfScribe(sessionId);
    if (!leaderId) return;
    const delivery = this.awaiting.get(leaderId);
    this.awaiting.delete(leaderId);
    if (delivery) {
      const left = await this.workLeft(leaderId, delivery);
      if (left.length && !delivery.reminded && this.deps.inject(sessionId, reminderMessage(left))) {
        this.awaiting.set(leaderId, { ...delivery, sentAt: this.now(), reminded: true });
        this.deps.broadcastChanged();
        return;
      }
      if (left.length) this.deps.notifyLeader(leaderId, leaderNotice(this.deps.sessionNum(sessionId), left));
    }
    this.deps.broadcastChanged();
    await this.deliver(leaderId);
  }

  /** What a message asked for and is still not done, in a line each. */
  private async workLeft(leaderId: string, delivery: Delivery): Promise<string[]> {
    const leader = this.deps.getLeaderInfo(leaderId);
    if (!leader) return [];
    const ownQuests = await this.leaderQuestIds(leaderId);
    const topics = this.store.list(leader.space).filter((topic) => topic.questIds.some((id) => ownQuests.has(id)));
    if (delivery.purpose === "initialize") {
      const { done, total } = await this.sortingProgress(leaderId);
      const pageless = topics
        .filter((topic) => topic.upToDateAt === null)
        .map((topic) => `"${topic.name}" has no page yet`);
      return done === 0 && total > 0 ? [`none of ${total} recent quests is under a topic yet`, ...pageless] : pageless;
    }
    return this.store.list(leader.space).flatMap((topic) => {
      const unread = this.store
        .pendingEvents(topic.id, leaderId)
        .filter((event) => (event.seq ?? 0) <= delivery.throughSeq && !event.byScribe).length;
      return unread ? [`"${topic.name}": ${unread} event${unread === 1 ? "" : "s"} not on its page yet`] : [];
    });
  }

  /**
   * Turns topics on or off for a leader. Turning on starts its Scribe, which initializes: it sorts
   * the leader's recent work into topics and writes the pages. Turning off archives the Scribe.
   */
  async setLeaderEnabled(sessionId: string, enabled: boolean): Promise<void> {
    const leader = this.deps.getLeaderInfo(sessionId);
    if (!leader?.isOrchestrator) throw new Error("Topics can be turned on only for leaders.");
    this.store.setLeaderEnabled(sessionId, enabled);
    const session = this.deps.getSession(sessionId);
    if (enabled && session) this.store.setCursor(sessionId, session.messageHistory.length);
    if (!enabled) {
      const scribe = this.store.scribeSession(sessionId);
      this.store.setScribeSession(sessionId, undefined);
      this.awaiting.delete(sessionId);
      this.forced.delete(sessionId);
      if (scribe && this.deps.isScribeAlive(scribe)) await this.deps.retireScribe(scribe);
    }
    await this.store.flush();
    this.deps.broadcastChanged();
    if (enabled) await this.deliver(sessionId);
  }

  /** At startup: Scribes whose pages predate the current page format are asked to rewrite them. */
  askOutdatedScribes(): void {
    for (const leaderId of this.store.enabledLeaderIds()) {
      if (this.store.pageFormat(leaderId) < PAGE_FORMAT && !this.store.needsInitialization(leaderId)) {
        this.changed(leaderId);
      }
    }
  }

  /** Archives page writers of the retired one-per-space design. */
  async retireLegacyWriters(): Promise<void> {
    const ids = this.store.takeLegacyWriters();
    await this.store.flush();
    for (const id of ids) {
      if (this.deps.isScribeAlive(id)) await this.deps.retireScribe(id);
    }
  }

  /** The leader's Scribe, started when it has none (or its session is gone). */
  private async ensureScribe(leader: TopicLeaderInfo): Promise<string> {
    const existing = this.store.scribeSession(leader.sessionId);
    if (existing && this.deps.isScribeAlive(existing)) return existing;
    const sessionId = await this.deps.createScribe(leader);
    this.store.setScribeSession(leader.sessionId, sessionId);
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
        const quotes = [...segment.matchAll(/["“]([^"“”]{3,})["”]/g)].map((match) => match[1]);
        if (quotes.length === 0) continue;
        const text = this.deps.messageText(Number(link[1]), Number(link[2]));
        if (text === null) continue;
        const haystack = normalizeQuote(text);
        for (const quote of quotes) {
          const parts = quote
            .split(/\.\.\.|…/)
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

  /** A leader's Scribe: what it is doing and how the user set it. */
  async overview(leaderId: string): Promise<ScribeOverview> {
    return {
      activity: await this.activity(leaderId),
      paused: this.store.isScribePaused(leaderId),
      budget: this.budget(leaderId),
      instructions: this.store.scribeInstructions(leaderId)?.text ?? "",
    };
  }

  /** What a leader's Scribe is doing, in one line for the panel and `takode scribe status`. */
  async activity(leaderId: string): Promise<ScribeActivity> {
    const leader = this.deps.getLeaderInfo(leaderId);
    if (!leader || !this.store.isLeaderEnabled(leaderId)) return { state: "off", text: "Topics are off", pending: 0 };
    const scribe = this.store.scribeSession(leaderId);
    const alive = !!scribe && this.deps.isScribeAlive(scribe);
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
      ...(alive ? { sessionId: scribe, sessionNum: this.deps.sessionNum(scribe!) } : {}),
      pending,
      ...(lastPageAt ? { lastPageAt } : {}),
    };
    if (!alive) return { state: "starting", text: "Starting the Scribe", ...base };
    const delivery = this.awaiting.get(leaderId);
    if (delivery?.purpose === "initialize") {
      const { done, total } = await this.sortingProgress(leaderId);
      return {
        state: "initializing",
        text: `Sorting recent work into topics: ${done} of ${total} quests`,
        progress: { done, total },
        ...base,
      };
    }
    if (this.deps.isScribeBusy(scribe!)) {
      const names = delivery?.topics ?? [];
      const text = names.length
        ? `Updating ${names.slice(0, 2).join(", ")}${names.length > 2 ? ` and ${names.length - 2} more` : ""}…`
        : "Working…";
      return { state: "updating", text, ...base };
    }
    if (this.store.isScribePaused(leaderId)) {
      return { state: "paused", text: pending ? `Paused · ${pending} events not on pages` : "Paused", ...base };
    }
    if (pending && this.budget(leaderId).overBudget) {
      return { state: "over_budget", text: `${pending} events wait for budget`, ...base };
    }
    if (pending) {
      return { state: "waiting", text: `${pending} event${pending === 1 ? "" : "s"} not on pages yet`, ...base };
    }
    return { state: "idle", text: "Up to date", ...base };
  }

  /** A Scribe's spend over the last day against a share of its leader's spend. */
  budget(leaderId: string): { used: number; limit: number; overBudget: boolean } {
    const since = this.now() - SPEND_WINDOW_MS;
    const leaderSpend = sessionSpend(this.deps.getSession(leaderId), since);
    const scribe = this.store.scribeSession(leaderId);
    const used = scribe ? sessionSpend(this.deps.getSession(scribe), since) : 0;
    const limit = leaderSpend * SCRIBE_BUDGET_SHARE;
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

  /** How many of the leader's recent quests are under a topic. */
  private async sortingProgress(leaderId: string): Promise<{ done: number; total: number }> {
    const quests = await this.leaderQuests(leaderId, this.now() - RECENT_WINDOW_MS);
    return { done: quests.filter((quest) => this.store.topicOfQuest(quest.questId)).length, total: quests.length };
  }

  /** The leader's quests created since a time, oldest first. */
  private async leaderQuests(leaderId: string, since: number): Promise<QuestmasterTask[]> {
    return (await this.deps.listQuests())
      .filter((quest) => (quest as { leaderSessionId?: string }).leaderSessionId === leaderId)
      .filter((quest) => quest.createdAt > since)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  private async leaderQuestIds(leaderId: string): Promise<Set<string>> {
    return new Set(
      (await this.deps.listQuests())
        .filter((quest) => (quest as { leaderSessionId?: string }).leaderSessionId === leaderId)
        .map((quest) => quest.questId),
    );
  }

  private enabledLeadersIn(space: string): string[] {
    return this.store.enabledLeaderIds().filter((leaderId) => this.deps.getLeaderInfo(leaderId)?.space === space);
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
 * prices (cache reads cheap, output dear), so leaders and Scribes compare fairly.
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

/** A history message's text: a user message with its comments, or an answer's text blocks. */
export function historyMessageText(message: BrowserIncomingMessage): string {
  if (message.type === "user_message") {
    return formatAnnotatedMessage(typeof message.content === "string" ? message.content : "", message.annotations);
  }
  if (message.type !== "assistant") return "";
  return (message.message?.content ?? []).map((block) => (block.type === "text" ? block.text : "")).join("\n");
}
