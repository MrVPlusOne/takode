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

/**
 * Keeps topic pages current, close to real time, with one Scribe per leader that has topics
 * on: a worker in that leader's herd. Events (its quests filed or finished, the user's messages in
 * those quests' tabs, artifacts saved there, fixes the user asked for) mark their topic changed for
 * that leader; about a minute after the first one, the leader's Scribe is asked to update the
 * changed topics, reading only its leader's new events. Topics stay shared across the session
 * space, so pages can hold several leaders' work. A Scribe's spend stays within a share of its
 * leader's own, and each leader's Scribe can be paused.
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
  /** Starts a leader's Scribe as a worker in its herd; returns its session ID. */
  createScribe: (leader: TopicLeaderInfo) => Promise<string>;
  isScribeAlive: (sessionId: string) => boolean;
  /** Whether the Scribe is working on a turn now. */
  isScribeBusy: (sessionId: string) => boolean;
  /** About how many tokens the Scribe's conversation holds. */
  scribeContextTokens: (sessionId: string) => number;
  /** Archives a Scribe (replaced, or its leader turned topics off). */
  retireScribe: (sessionId: string) => Promise<void>;
  /** The text of a message by session number and history index, or null when it can't be read. */
  messageText: (sessionNum: number, index: number) => string | null;
  /** Tells browsers the topics changed. */
  broadcastChanged: () => void;
  now?: () => number;
}

/** Events wait this long for more before the Scribe is asked. */
export const TOPIC_UPDATE_DELAY_MS = 60_000;
/** A request the Scribe hasn't answered is sent again after this long. */
const REQUEST_TIMEOUT_MS = 15 * 60_000;
const SPEND_WINDOW_MS = 24 * 60 * 60_000;
const BACKFILL_WINDOW_MS = 30 * 24 * 60 * 60_000;
/**
 * A Scribe whose conversation holds more than this is replaced before its next request: each update
 * needs only its brief and what is new, while a long conversation is reread (and paid for) on every
 * update.
 */
export const SCRIBE_CONTEXT_LIMIT = 100_000;
const EXCERPT_CHARS = 280;
const MAX_UNFILED_LISTED = 20;

interface ScribeRequest {
  at: number;
  kind: "backfill" | "update";
  topics: string[];
}

export class TopicService {
  /** Per leader: the pending update timer. */
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Per leader: the request its Scribe is working on, until the turn that took it ends. */
  private requested = new Map<string, ScribeRequest>();
  /** Leaders whose update waited for their Scribe's turn to end; it is asked again then. */
  private held = new Set<string>();
  /** Per Scribe session: the save time of the grouping instructions it was told. */
  private instructionsTold = new Map<string, number>();
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
      // A comment-only message has its words in its comments.
      const text = formatAnnotatedMessage(
        typeof message.content === "string" ? message.content : "",
        "annotations" in message ? message.annotations : undefined,
      );
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
   * The user asked for a fix on a topic's page: it goes to the Scribe of the leader whose panel it
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

  /** The user undid a tidying change: the pages that describe it are told by the Scribes involved. */
  undone(space: string): void {
    for (const leader of this.enabledLeadersIn(space)) this.schedule(leader);
  }

  /** The user changed how to group a leader's topics: its Scribe hears about it on the next request. */
  instructionsChanged(leaderId: string): void {
    if (this.store.isLeaderEnabled(leaderId)) this.schedule(leaderId, 0);
  }

  /** Records an event for a leader's Scribe and schedules its update about a minute after the first. */
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

  // ─── Asking the Scribe ────────────────────────────────────────────────────

  /**
   * Asks a leader's Scribe to update every topic with pending events of that leader, file its
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
    const instructions = this.store.scribeInstructions(leaderId);
    // Changed instructions alone wake the current Scribe; a new Scribe gets them with its first request.
    const current = this.store.scribeSession(leaderId);
    const instructionsChanged =
      !!instructions && !!current && instructions.updatedAt !== this.instructionsTold.get(current);
    if (topics.length === 0 && folds.length === 0 && unfiled.length === 0 && !instructionsChanged) return "nothing";
    if (!options.force) {
      if (this.store.isScribePaused(leaderId)) return "paused";
      if (this.budget(leaderId).overBudget) return "over_budget";
      const pending = this.requested.get(leaderId);
      if ((pending && this.now() - pending.at < REQUEST_TIMEOUT_MS) || (current && this.deps.isScribeBusy(current))) {
        this.held.add(leaderId);
        return "busy";
      }
    }
    const scribe = await this.ensureScribe(leader);
    const tellInstructions = !!instructions && instructions.updatedAt !== this.instructionsTold.get(scribe);
    const lines = [
      `Update the topic pages for leader #${leader.sessionNum ?? "?"}.`,
      ...(tellInstructions
        ? [
            "",
            `The user's grouping instructions changed: "${instructions!.text}". Re-file or tidy where they call for it.`,
          ]
        : []),
      ...(topics.length
        ? [
            "",
            ...topics.map(
              ({ topic, pending }) =>
                `- "${topic.name}" (${topic.id.slice(0, 8)}): ${pending} new event${pending === 1 ? "" : "s"}${topic.upToDateAt === null ? ", no page yet" : ""}.`,
            ),
            "Run `takode scribe changes <topic>` for each.",
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
    if (!this.deps.inject(scribe, lines.join("\n"))) return "busy";
    this.requested.set(leaderId, { at: this.now(), kind: "update", topics: topics.map(({ topic }) => topic.name) });
    if (instructions) this.instructionsTold.set(scribe, instructions.updatedAt);
    this.held.delete(leaderId);
    this.deps.broadcastChanged();
    return "asked";
  }

  /** A page was saved: the panels show it. */
  pageSaved(): void {
    this.deps.broadcastChanged();
  }

  /**
   * A Scribe ended a turn: the request it took is answered, whether it wrote pages or only filed
   * quests or tidied topics. An update held back meanwhile is asked for now (after the usual pause).
   */
  scribeTurnEnded(sessionId: string): void {
    const leaderId = this.store.leaderOfScribe(sessionId);
    if (!leaderId) return;
    this.requested.delete(leaderId);
    this.deps.broadcastChanged();
    if (this.held.delete(leaderId)) this.schedule(leaderId);
  }

  /**
   * Turns topics on or off for a leader. Turning on starts its Scribe, which first files the
   * leader's last month of quests; turning off archives the Scribe.
   */
  async setLeaderEnabled(sessionId: string, enabled: boolean): Promise<void> {
    const leader = this.deps.getLeaderInfo(sessionId);
    if (!leader?.isOrchestrator) throw new Error("Topics can be turned on only for leaders.");
    const { needsBackfill } = this.store.setLeaderEnabled(sessionId, enabled);
    const session = this.deps.getSession(sessionId);
    if (enabled && session) this.store.setCursor(sessionId, session.messageHistory.length);
    if (!enabled) {
      const scribe = this.store.scribeSession(sessionId);
      this.store.setScribeSession(sessionId, undefined);
      this.requested.delete(sessionId);
      this.held.delete(sessionId);
      if (scribe && this.deps.isScribeAlive(scribe)) await this.deps.retireScribe(scribe);
    }
    await this.store.flush();
    this.deps.broadcastChanged();
    if (!enabled) return;
    const scribe = await this.ensureScribe(leader);
    if (!needsBackfill) return;
    const instructions = this.store.scribeInstructions(sessionId);
    const delivered = this.deps.inject(
      scribe,
      [
        `Topics were turned on for your leader #${leader.sessionNum ?? "?"} "${leader.name}".`,
        "File its quests from the last 30 days into topics (`takode scribe quests --unfiled` lists them), then write each topic's page.",
        ...(instructions ? ["", `The user's grouping instructions: "${instructions.text}"`] : []),
      ].join("\n"),
    );
    if (delivered) {
      this.store.markBackfilled(sessionId);
      this.requested.set(sessionId, { at: this.now(), kind: "backfill", topics: [] });
      if (instructions) this.instructionsTold.set(scribe, instructions.updatedAt);
      await this.store.flush();
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

  private async ensureScribe(leader: TopicLeaderInfo): Promise<string> {
    const existing = this.store.scribeSession(leader.sessionId);
    if (existing && this.deps.isScribeAlive(existing)) {
      // Never replace a Scribe that may still be working on a request.
      if (this.requested.has(leader.sessionId) || this.deps.scribeContextTokens(existing) <= SCRIBE_CONTEXT_LIMIT) {
        return existing;
      }
      this.store.recordRetiredScribeSpend(
        leader.sessionId,
        sessionSpend(this.deps.getSession(existing), this.now() - SPEND_WINDOW_MS),
      );
      await this.deps.retireScribe(existing);
      this.instructionsTold.delete(existing);
    }
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
    const request = this.requested.get(leaderId);
    if (request?.kind === "backfill") {
      const { done, total } = await this.filingProgress(leaderId);
      if (done < total) {
        return { state: "filing", text: `Filing ${done} of ${total} quests`, progress: { done, total }, ...base };
      }
    }
    if (this.deps.isScribeBusy(scribe!)) {
      const names = request?.topics ?? [];
      const text = names.length
        ? `Updating ${names.slice(0, 2).join(", ")}${names.length > 2 ? ` and ${names.length - 2} more` : ""}…`
        : "Working…";
      return { state: "updating", text, ...base };
    }
    if (this.store.isScribePaused(leaderId)) {
      return { state: "paused", text: pending ? `Paused · ${pending} updates waiting` : "Paused", ...base };
    }
    if (pending && this.budget(leaderId).overBudget) {
      return { state: "over_budget", text: `${pending} updates wait for budget`, ...base };
    }
    if (pending) return { state: "waiting", text: `${pending} update${pending === 1 ? "" : "s"} coming`, ...base };
    return { state: "idle", text: "Up to date", ...base };
  }

  /** A Scribe's spend over the last day against a share of its leader's spend. */
  budget(leaderId: string): { used: number; limit: number; overBudget: boolean } {
    const since = this.now() - SPEND_WINDOW_MS;
    const leaderSpend = sessionSpend(this.deps.getSession(leaderId), since);
    const scribe = this.store.scribeSession(leaderId);
    const used =
      (scribe ? sessionSpend(this.deps.getSession(scribe), since) : 0) + this.store.retiredScribeSpend(leaderId, since);
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
