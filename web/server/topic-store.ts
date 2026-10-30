import { topicHandle } from "../shared/topic-thread-key.js";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type NowEntry, type NowGroup, NOW_GROUPS, questLinksOf, takeLegacyNow } from "../shared/topic-now-items.js";
import {
  TOPIC_TENTATIVE_MS,
  type QuestTopicMap,
  type TopicChange,
  type TopicDetail,
  type TopicEvent,
  type TopicNameSource,
  type TopicRenameSuggestion,
  type TopicSummary,
  type ThreadSummary,
  type TopicThreadRef,
} from "../shared/library-topics.js";

/**
 * Library topics on disk (`topics.json` beside the artifact library): topics per session space,
 * which topic each quest is filed under, each topic's page and the events since it was written,
 * and per leader: the switch, its Scribe (session, pause, the user's instructions, spend
 * of replaced Scribes) and how far each page covers its activity. Also the change list whose entries can be undone, and
 * rename suggestions waiting for the user. Writes are whole-file and atomic, chained in order.
 */

const MAX_EVENTS_PER_TOPIC = 200;
const MAX_CHANGES = 300;
const MAX_QUESTS_TOLD = 500;
const DONE_KEPT_MS = 24 * 60 * 60 * 1000;
/** How long the panel offers a change to undo before it goes away on its own. */
export const CHANGE_SHOWN_MS = 24 * 60 * 60 * 1000;

interface StoredTopic {
  id: string;
  space: string;
  name: string;
  nameSource: TopicNameSource;
  aliases: string[];
  createdAt: number;
  updatedAt: number;
  page: string | null;
  /** Newest event any page write covered (for display); see `coveredThrough` per leader. */
  upToDateAt: number | null;
  writtenAt: number | null;
  /** When a Scribe last confirmed the page needs no change (`write-page --unchanged`). */
  checkedAt?: number;
  /** Per leader: the page covers that leader's events up to this time. */
  coveredThrough?: Record<string, number>;
  /** Bumped by each page write, so a Scribe that read an older page cannot overwrite a newer one. */
  pageRevision?: number;
  events: TopicEvent[];
  /** The topic's Now: open items, added and removed by Scribes, marked done by the user. */
  now?: StoredNowEntry[];
  /** Retired: dates of Now items read from the page text; moved into `now` at load. */
  nowItems?: Record<string, { since: number; changedAt: number; text: string }>;
  /** The user's lasting requests for this page (sections to keep, what to show). */
  instructions?: { text: string; updatedAt: number };
  /** Set when merged or folded into another topic; such a topic is hidden. */
  mergedInto?: string;
  /** A leader started it (filing a quest under a new name): that leader's Scribe checks it is distinct enough. */
  reviewFor?: string;
  /**
   * The local images the page shows, by the path it uses: the modification time last reported to
   * Scribes (or found when first checked). A later time means the picture was redrawn since.
   */
  pictures?: Record<string, number>;
  /** Per folder of those images: images in it changed up to this time were already offered to Scribes. */
  pictureFolders?: Record<string, number>;
  /**
   * Set on a thread the user started (New thread), which is stored like a topic for its thread
   * plumbing but is not one: never listed or paged as a topic, never matched by name.
   */
  thread?: StoredThread;
}

interface StoredThread {
  leaderId: string;
  startedFrom?: string;
  /** The topic it is filed under. */
  topicId?: string;
  settledAt?: number;
  /** When a message was last written in it (its own events are not kept). */
  lastMessageAt?: number;
  /** The user's first message, shortened: what the thread is about, for filing it. */
  firstMessage?: string;
  /** When its leader's Scribe was asked to file it, after it settled under no topic. */
  sortAskedAt?: number;
}

interface StoredNowEntry {
  id: string;
  group: NowGroup;
  who?: string;
  text: string;
  leaderId?: string;
  since: number;
  changedAt: number;
  due?: string;
  doneAt?: number;
}

type Undo =
  | { kind: "rename"; topicId: string; name: string; nameSource: TopicNameSource }
  | { kind: "merge"; from: StoredTopic; intoId: string; intoAliases: string[]; questIds: string[] }
  | { kind: "move"; questId: string; fromTopicId: string | null; createdTopicId?: string };

interface StoredChange extends TopicChange {
  undo: Undo;
  /** The user put it out of the panel without undoing it. */
  dismissed?: boolean;
}

interface StoredSuggestion {
  id: string;
  topicId: string;
  name: string;
  reason?: string;
  leaderId?: string;
  at: number;
  status: "pending" | "accepted" | "dismissed";
}

interface TopicState {
  version: 1;
  topics: Record<string, StoredTopic>;
  questTopics: Record<string, string>;
  enabledLeaders: Record<string, { enabledAt: number; initializedAt?: number }>;
  /**
   * Leaders the user turned topics off for, and when. Topics are on for every other leader by
   * default, so these are the ones that stay off.
   */
  disabledLeaders?: Record<string, number>;
  /** When topics became on by default; leaders turned off before it were recorded as turned off then. */
  onByDefaultSince?: number;
  /** Retired: dismissals of the hint that offered topics while they were opt-in. Not read. */
  hintDismissed?: Record<string, number>;
  /** Per leader: its Scribe. */
  scribes?: Record<string, StoredScribe>;
  /** Sequence number of the newest event, so a Scribe is sent each event exactly once. */
  eventSeq?: number;
  /** Retired design: one hidden page writer per space. Read once at startup to archive them. */
  writers?: Record<string, string>;
  suggestions?: StoredSuggestion[];
  /** Per leader: history messages already read for events. */
  cursors: Record<string, number>;
  /** Per quest under a topic: its ticked checks and feedback entries already turned into events. */
  questMarks?: Record<string, QuestMark>;
  changes: StoredChange[];
}

/** A leader's Scribe: the worker in its herd that keeps its topic pages, and how the user set it. */
interface StoredScribe {
  sessionId?: string;
  paused?: boolean;
  /** The user's lasting instructions for the leader's topics and pages. */
  instructions?: ScribeInstructions;
  /** Events up to this sequence number were sent to the Scribe. */
  deliveredSeq?: number;
  /** Quests with no topic the Scribe was already told about (newest last, capped). */
  questsTold?: string[];
  /** Save time of the instructions this Scribe session was sent. */
  instructionsSentAt?: number;
  /** The page format the Scribe last wrote its pages in (it is asked once to rewrite older ones). */
  pageFormat?: number;
  /**
   * How many topics the leader had when its Scribe was last asked to merge some (over the target).
   * It is asked again only once the count grows past that, so a Scribe that found nothing to merge
   * isn't asked on every update; back under the target, it is cleared.
   */
  consolidationAskedAt?: number;
}

/** What of a quest was already reported to Scribes: ticked checks (by text) and feedback count. */
export interface QuestMark {
  checked: string[];
  feedback: number;
}

export interface ScribeInstructions {
  text: string;
  updatedAt: number;
}

export class TopicStoreError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 = 400,
  ) {
    super(message);
  }
}

export class TopicStore {
  private state: TopicState | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  private dirty = false;
  /** Told whenever one of a leader's threads changes, so an open Threads menu updates at once. */
  onThreadChange?: (leaderId: string) => void;

  constructor(
    readonly root: string,
    private readonly now: () => number = Date.now,
  ) {}

  async load(): Promise<void> {
    if (this.state) return;
    try {
      const parsed = JSON.parse(await readFile(join(this.root, "topics.json"), "utf-8")) as TopicState;
      if (parsed?.version !== 1 || typeof parsed.topics !== "object") throw new Error("unknown topics format");
      this.state = parsed;
      for (const topic of Object.values(parsed.topics)) {
        this.moveNowOffPage(topic);
        this.retireWaitingOnYou(topic);
      }
      this.coverMergedEvents();
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
        console.error("[library-topics] Unreadable topics file, keeping it aside:", error);
        await rename(join(this.root, "topics.json"), join(this.root, `topics.unreadable-${this.now()}.json`)).catch(
          () => {},
        );
      }
      this.state = {
        version: 1,
        topics: {},
        questTopics: {},
        enabledLeaders: {},
        cursors: {},
        changes: [],
      };
    }
  }

  get loaded(): boolean {
    return this.state !== null;
  }

  // ─── Leaders ──────────────────────────────────────────────────────────────

  isLeaderEnabled(sessionId: string): boolean {
    return !!this.s().enabledLeaders[sessionId];
  }

  enabledLeaderIds(): string[] {
    return Object.keys(this.s().enabledLeaders);
  }

  /**
   * Turns topics on or off for a leader; returns whether its Scribe still has to initialize. The
   * user's own choice (`byUser`) is remembered: a leader the user turned off stays off, while one
   * turned off with every leader (Settings) comes back on with them.
   */
  setLeaderEnabled(sessionId: string, enabled: boolean, byUser = false): { needsInitialization: boolean } {
    const state = this.s();
    const leaders = state.enabledLeaders;
    if (byUser || enabled) {
      if (!enabled) (state.disabledLeaders ??= {})[sessionId] = this.now();
      else if (state.disabledLeaders?.[sessionId]) delete state.disabledLeaders[sessionId];
      this.dirty = true;
    }
    if (!enabled) {
      if (leaders[sessionId]) {
        delete leaders[sessionId];
        this.dirty = true;
      }
      return { needsInitialization: false };
    }
    leaders[sessionId] ??= { enabledAt: this.now() };
    this.dirty = true;
    return { needsInitialization: !leaders[sessionId].initializedAt };
  }

  /** The user turned topics off for this leader, so they don't come on by default. */
  turnedOffByUser(sessionId: string): boolean {
    return !!this.s().disabledLeaders?.[sessionId];
  }

  /**
   * Once, when topics become on by default: a leader that had topics before (it has a Scribe
   * record) but has them off now was turned off by the user, so it stays off.
   */
  recordEarlierTurnOffs(): void {
    const state = this.s();
    if (state.onByDefaultSince) return;
    state.onByDefaultSince = this.now();
    for (const leaderId of Object.keys(state.scribes ?? {})) {
      if (!state.enabledLeaders[leaderId]) (state.disabledLeaders ??= {})[leaderId] = state.onByDefaultSince;
    }
    this.dirty = true;
  }

  /** Topics are on for the leader and its Scribe has not been asked to initialize yet. */
  needsInitialization(sessionId: string): boolean {
    const leader = this.s().enabledLeaders[sessionId];
    return !!leader && !leader.initializedAt;
  }

  markInitialized(sessionId: string): void {
    const leader = this.s().enabledLeaders[sessionId];
    if (!leader) return;
    leader.initializedAt = this.now();
    this.dirty = true;
  }

  // ─── Scribes ──────────────────────────────────────────────────────────────

  scribeSession(leaderId: string): string | undefined {
    return this.s().scribes?.[leaderId]?.sessionId;
  }

  /** Sets a leader's Scribe session; a new session has been sent no instructions yet. */
  setScribeSession(leaderId: string, sessionId: string | undefined): void {
    const scribe = this.scribeRecord(leaderId);
    if (scribe.sessionId === sessionId) return;
    scribe.sessionId = sessionId;
    scribe.instructionsSentAt = undefined;
    this.dirty = true;
  }

  /** Events up to this sequence number were sent to the leader's Scribe. */
  deliveredSeq(leaderId: string): number {
    return this.s().scribes?.[leaderId]?.deliveredSeq ?? 0;
  }

  /** The newest event's sequence number. */
  eventSeq(): number {
    return this.s().eventSeq ?? 0;
  }

  /** Marks events up to `seq`, and these quests with no topic, as sent to the Scribe. */
  /** Topics a leader started that its Scribe hasn't checked yet. */
  topicsToReview(leaderId: string): TopicSummary[] {
    return this.liveTopics()
      .filter((topic) => topic.reviewFor === leaderId)
      .map((topic) => this.summary(topic));
  }

  /** A leader started this topic: its Scribe checks with its next message that it is distinct enough. */
  markForReview(topicId: string, leaderId: string): void {
    const topic = this.live(topicId);
    if (!topic || topic.nameSource === "user") return;
    topic.reviewFor = leaderId;
    this.dirty = true;
  }

  reviewed(topicIds: readonly string[]): void {
    for (const id of topicIds) {
      const topic = this.s().topics[id];
      if (topic?.reviewFor) {
        delete topic.reviewFor;
        this.dirty = true;
      }
    }
  }

  consolidationAskedAt(leaderId: string): number | undefined {
    return this.s().scribes?.[leaderId]?.consolidationAskedAt;
  }

  setConsolidationAskedAt(leaderId: string, count: number | undefined): void {
    const scribe = this.scribeRecord(leaderId);
    if (scribe.consolidationAskedAt === count) return;
    scribe.consolidationAskedAt = count;
    this.dirty = true;
  }

  markDelivered(leaderId: string, seq: number, questIds: readonly string[] = []): void {
    const scribe = this.scribeRecord(leaderId);
    scribe.deliveredSeq = Math.max(seq, scribe.deliveredSeq ?? 0);
    if (questIds.length) scribe.questsTold = [...(scribe.questsTold ?? []), ...questIds].slice(-MAX_QUESTS_TOLD);
    this.dirty = true;
  }

  questsTold(leaderId: string): ReadonlySet<string> {
    return new Set(this.s().scribes?.[leaderId]?.questsTold ?? []);
  }

  pageFormat(leaderId: string): number {
    return this.s().scribes?.[leaderId]?.pageFormat ?? 1;
  }

  setPageFormat(leaderId: string, format: number): void {
    this.scribeRecord(leaderId).pageFormat = format;
    this.dirty = true;
  }

  /** Whether the Scribe session has been sent the current instructions. */
  instructionsSent(leaderId: string): boolean {
    const scribe = this.s().scribes?.[leaderId];
    return !scribe?.instructions || scribe.instructionsSentAt === scribe.instructions.updatedAt;
  }

  markInstructionsSent(leaderId: string): void {
    const scribe = this.scribeRecord(leaderId);
    scribe.instructionsSentAt = scribe.instructions?.updatedAt;
    this.dirty = true;
  }

  leaderOfScribe(sessionId: string): string | undefined {
    return Object.entries(this.s().scribes ?? {}).find(([, scribe]) => scribe.sessionId === sessionId)?.[0];
  }

  isScribePaused(leaderId: string): boolean {
    return !!this.s().scribes?.[leaderId]?.paused;
  }

  setScribePaused(leaderId: string, paused: boolean): void {
    this.scribeRecord(leaderId).paused = paused || undefined;
    this.dirty = true;
  }

  scribeInstructions(leaderId: string): ScribeInstructions | undefined {
    return this.s().scribes?.[leaderId]?.instructions;
  }

  setScribeInstructions(leaderId: string, text: string): void {
    const clean = text.trim().slice(0, 4000);
    this.scribeRecord(leaderId).instructions = clean ? { text: clean, updatedAt: this.now() } : undefined;
    this.dirty = true;
  }

  /** Page writers of the retired per-space design, to be archived once; forgets them. */
  takeLegacyWriters(): string[] {
    const ids = Object.values(this.s().writers ?? {});
    if (ids.length === 0) return [];
    delete this.s().writers;
    this.dirty = true;
    return ids;
  }

  questMark(questId: string): QuestMark | undefined {
    return this.s().questMarks?.[questId];
  }

  setQuestMark(questId: string, mark: QuestMark): void {
    const state = this.s();
    state.questMarks = { ...state.questMarks, [questId]: mark };
    this.dirty = true;
  }

  cursorFor(leaderId: string): number | undefined {
    return this.s().cursors[leaderId];
  }

  setCursor(leaderId: string, count: number): void {
    if (this.s().cursors[leaderId] === count) return;
    this.s().cursors[leaderId] = count;
    this.dirty = true;
  }

  // ─── Topics and quests ────────────────────────────────────────────────────

  /** A live topic of the space by name or former name, ignoring case and spacing. */
  findByName(space: string, name: string): StoredTopic | undefined {
    const wanted = normalizeName(name);
    return this.liveTopics(space).find(
      (topic) => normalizeName(topic.name) === wanted || topic.aliases.some((alias) => normalizeName(alias) === wanted),
    );
  }

  topicOfQuest(questId: string): StoredTopic | undefined {
    const id = this.s().questTopics[questId];
    return id ? this.live(id) : undefined;
  }

  questTopicMap(questIds: readonly string[]): QuestTopicMap {
    const map: QuestTopicMap = {};
    for (const questId of questIds) {
      const topic = this.topicOfQuest(questId);
      if (topic) map[questId] = { id: topic.id, name: topic.name };
    }
    return map;
  }

  questsOf(topicId: string): string[] {
    return Object.entries(this.s().questTopics)
      .filter(([, id]) => id === topicId)
      .map(([questId]) => questId);
  }

  /**
   * Files a quest under a topic by name, creating the topic when none of the space has that name.
   * Filing a quest already under another topic moves it, and the move can be undone.
   */
  assign(input: {
    questId: string;
    space: string;
    name: string;
    by: TopicNameSource;
    byAgent: boolean;
    /** The quest's leader, whose Scribe hears of the filing. */
    leaderId?: string;
  }): {
    topic: TopicSummary;
    created: boolean;
    moved: boolean;
  } {
    const name = cleanName(input.name);
    let topic = this.findByName(input.space, name);
    const created = !topic;
    if (!topic) topic = this.createTopic(input.space, name, input.by);
    const previous = this.topicOfQuest(input.questId);
    if (previous?.id === topic.id) return { topic: this.summary(topic), created, moved: false };
    this.s().questTopics[input.questId] = topic.id;
    topic.updatedAt = this.now();
    this.addEvent(topic.id, {
      at: this.now(),
      kind: "quest_filed",
      questId: input.questId,
      ...(input.byAgent ? { byScribe: true } : {}),
      ...(input.leaderId ? { leaderId: input.leaderId } : {}),
    });
    if (previous) {
      this.recordChange(
        input.space,
        `Moved ${input.questId} from "${previous.name}" to "${topic.name}"`,
        input.byAgent,
        {
          kind: "move",
          questId: input.questId,
          fromTopicId: previous.id,
          ...(created ? { createdTopicId: topic.id } : {}),
        },
      );
    }
    this.dirty = true;
    return { topic: this.summary(topic), created, moved: !!previous };
  }

  /**
   * Starts a thread the user opened with New thread: a lightweight conversation of the leader's
   * space, named after its first words until the leader names it. It is not a topic.
   */
  startThread(input: {
    space: string;
    name: string;
    leaderId: string;
    startedFrom?: string;
    firstMessage?: string;
  }): ThreadSummary {
    const topic = this.createTopic(input.space, cleanName(input.name), "agent");
    const firstMessage = input.firstMessage?.trim().slice(0, 400);
    topic.thread = {
      leaderId: input.leaderId,
      ...(input.startedFrom ? { startedFrom: input.startedFrom } : {}),
      ...(firstMessage ? { firstMessage } : {}),
    };
    this.dirty = true;
    this.onThreadChange?.(input.leaderId);
    return this.threadSummary(topic);
  }

  /** The threads the user started in this leader, newest activity first. */
  threadsOf(leaderId: string): ThreadSummary[] {
    return Object.values(this.s().topics)
      .filter((topic) => topic.thread?.leaderId === leaderId && !topic.mergedInto)
      .map((topic) => this.threadSummary(topic))
      .sort((a, b) => b.activityAt - a.activityAt);
  }

  /** A thread by ID or handle (also `topic:<handle>`); undefined for topics and unknown refs. */
  thread(ref: string): StoredTopic | undefined {
    const handle = topicHandle(ref.replace(/^topic:/i, ""));
    const topic = Object.values(this.s().topics).find((candidate) => topicHandle(candidate.id) === handle);
    return topic?.thread ? topic : undefined;
  }

  /**
   * Files a thread under an existing topic of its space (a lone thread never makes a new topic;
   * topics grow from work). Its later messages are that topic's news.
   */
  fileThread(threadId: string, topicRef: string, byAgent: boolean): ThreadSummary {
    const thread = this.thread(threadId);
    if (!thread?.thread) throw new TopicStoreError("Thread not found.", 404);
    const topic = this.resolve(topicRef, thread.space);
    if (!topic || topic.thread) {
      throw new TopicStoreError(
        `No topic "${topicRef}". A thread joins an existing topic; new topics grow from quests.`,
        404,
      );
    }
    if (thread.thread.topicId === topic.id) return this.threadSummary(thread);
    thread.thread.topicId = topic.id;
    this.addEvent(topic.id, {
      at: this.now(),
      kind: "message",
      text: `The thread "${thread.name}" was filed here`,
      leaderId: thread.thread.leaderId,
      ...(byAgent ? { byScribe: true } : {}),
    });
    this.dirty = true;
    this.onThreadChange?.(thread.thread.leaderId);
    return this.threadSummary(thread);
  }

  /**
   * Removes a thread whose first message never arrived (its send failed). A thread anyone wrote
   * in is a conversation and stays.
   */
  removeThread(threadKey: string): void {
    const thread = this.thread(threadKey);
    if (!thread?.thread) throw new TopicStoreError("Thread not found.", 404);
    if (thread.thread.lastMessageAt !== undefined)
      throw new TopicStoreError("Only a thread with no messages can be removed.", 409);
    delete this.s().topics[thread.id];
    this.dirty = true;
    this.onThreadChange?.(thread.thread.leaderId);
  }

  /** A quest was filed under a topic: a thread it was started from, under no topic yet, follows it. */
  threadFollowsQuest(threadKey: string | undefined, topicId: string): ThreadSummary | null {
    const thread = threadKey ? this.thread(threadKey) : undefined;
    if (!thread?.thread || thread.thread.topicId) return null;
    return this.fileThread(thread.id, topicId, false);
  }

  /**
   * You read a thread's last answer: it settles (leaves Active). Returns the thread when this
   * settled it and it is under no topic, so its leader's Scribe can file it; null otherwise.
   */
  settleThread(threadKey: string): ThreadSummary | null {
    const thread = this.thread(threadKey);
    if (!thread?.thread || thread.thread.settledAt) return null;
    thread.thread.settledAt = this.now();
    this.dirty = true;
    this.onThreadChange?.(thread.thread.leaderId);
    return thread.thread.topicId ? null : this.threadSummary(thread);
  }

  /** Settled threads under no topic that the Scribe wasn't asked to file yet. */
  settledUnfiledThreads(leaderId: string): Array<ThreadSummary & { firstMessage?: string }> {
    return Object.values(this.s().topics)
      .filter(
        (topic) =>
          topic.thread?.leaderId === leaderId &&
          !topic.mergedInto &&
          topic.thread.settledAt &&
          !topic.thread.topicId &&
          !topic.thread.sortAskedAt,
      )
      .map((topic) => ({
        ...this.threadSummary(topic),
        ...(topic.thread?.firstMessage ? { firstMessage: topic.thread.firstMessage } : {}),
      }));
  }

  /** Records that the Scribe was asked to file these settled threads. */
  markThreadsSortAsked(threadIds: readonly string[]): void {
    for (const id of threadIds) {
      const thread = this.s().topics[id]?.thread;
      if (thread) thread.sortAskedAt = this.now();
    }
    if (threadIds.length) this.dirty = true;
  }

  /** The threads filed under a topic. */
  threadsUnder(topicId: string): StoredTopic[] {
    return Object.values(this.s().topics).filter((topic) => topic.thread?.topicId === topicId && !topic.mergedInto);
  }

  private threadSummary(topic: StoredTopic): ThreadSummary {
    const thread = topic.thread!;
    const under = thread.topicId ? this.live(thread.topicId) : undefined;
    return {
      id: topic.id,
      key: `topic:${topicHandle(topic.id)}`,
      name: topic.name,
      leaderId: thread.leaderId,
      ...(thread.startedFrom ? { startedFrom: thread.startedFrom } : {}),
      ...(under ? { topic: { id: under.id, name: under.name } } : {}),
      createdAt: topic.createdAt,
      activityAt: thread.lastMessageAt ?? topic.createdAt,
      ...(thread.settledAt ? { settledAt: thread.settledAt } : {}),
      ...(thread.lastMessageAt === undefined ? { empty: true } : {}),
    };
  }

  /** Renames a topic; a name the user chose is never changed by an agent. */
  rename(topicId: string, name: string, by: TopicNameSource, byAgent: boolean): TopicSummary {
    const topic = this.require(topicId);
    const clean = cleanName(name);
    if (byAgent && topic.nameSource === "user") {
      throw new TopicStoreError(
        `"${topic.name}" was named by the user; suggest a new name instead of renaming it.`,
        403,
      );
    }
    const clash = this.findByName(topic.space, clean);
    if (clash && clash.id !== topic.id)
      throw new TopicStoreError(`Topic "${clash.name}" already exists; merge instead.`, 409);
    if (topic.name === clean) return this.summary(topic);
    const undo: Undo = { kind: "rename", topicId, name: topic.name, nameSource: topic.nameSource };
    if (!topic.aliases.includes(topic.name)) topic.aliases.push(topic.name);
    topic.aliases = topic.aliases.filter((alias) => normalizeName(alias) !== normalizeName(clean));
    this.recordChange(topic.space, `Renamed "${topic.name}" to "${clean}"`, byAgent, undo);
    topic.name = clean;
    topic.nameSource = by;
    topic.updatedAt = this.now();
    this.dirty = true;
    if (topic.thread) this.onThreadChange?.(topic.thread.leaderId);
    return this.summary(topic);
  }

  /**
   * A Scribe's new name for a topic the user named: shown to the user with Accept and Dismiss,
   * and nothing changes until accepted. A name the user dismissed is not suggested again.
   */
  suggestRename(
    topicId: string,
    name: string,
    leaderId: string | undefined,
    reason?: string,
  ): TopicRenameSuggestion | { skipped: string } {
    const topic = this.require(topicId);
    const clean = cleanName(name);
    const suggestions = (this.s().suggestions ??= []);
    const same = (candidate: StoredSuggestion) =>
      candidate.topicId === topic.id && normalizeName(candidate.name) === normalizeName(clean);
    if (suggestions.some((candidate) => same(candidate) && candidate.status === "dismissed")) {
      return {
        skipped: `The user dismissed renaming "${topic.name}" to "${clean}" before, so it is not suggested again.`,
      };
    }
    const pending = suggestions.find((candidate) => same(candidate) && candidate.status === "pending");
    if (pending) return this.publicSuggestion(pending)!;
    // A newer suggestion for the same topic replaces an older pending one.
    for (const candidate of suggestions) {
      if (candidate.topicId === topic.id && candidate.status === "pending") candidate.status = "dismissed";
    }
    const suggestion: StoredSuggestion = {
      id: randomUUID(),
      topicId: topic.id,
      name: clean,
      ...(reason?.trim() ? { reason: reason.trim().slice(0, 300) } : {}),
      ...(leaderId ? { leaderId } : {}),
      at: this.now(),
      status: "pending",
    };
    suggestions.push(suggestion);
    if (suggestions.length > MAX_CHANGES) suggestions.splice(0, suggestions.length - MAX_CHANGES);
    this.dirty = true;
    return this.publicSuggestion(suggestion)!;
  }

  suggestions(space?: string): TopicRenameSuggestion[] {
    return (this.s().suggestions ?? [])
      .filter((suggestion) => suggestion.status === "pending")
      .flatMap((suggestion) => {
        const view = this.publicSuggestion(suggestion);
        const topic = this.live(suggestion.topicId);
        return view && topic && (!space || topic.space === space) ? [view] : [];
      });
  }

  /** The user's answer to a rename suggestion; accepting renames the topic in the user's name. */
  answerSuggestion(id: string, accept: boolean): TopicSummary | null {
    const suggestion = (this.s().suggestions ?? []).find((candidate) => candidate.id === id);
    if (!suggestion || suggestion.status !== "pending") throw new TopicStoreError("Suggestion not found.", 404);
    suggestion.status = accept ? "accepted" : "dismissed";
    this.dirty = true;
    return accept ? this.rename(suggestion.topicId, suggestion.name, "user", false) : null;
  }

  private publicSuggestion(suggestion: StoredSuggestion): TopicRenameSuggestion | null {
    const topic = this.live(suggestion.topicId);
    if (!topic) return null;
    return {
      id: suggestion.id,
      topicId: topic.id,
      topicName: topic.name,
      name: suggestion.name,
      ...(suggestion.reason ? { reason: suggestion.reason } : {}),
      at: suggestion.at,
    };
  }

  /** Moves every quest of `fromId` into `intoId`; "fold" is the same for a tentative topic nothing joined. */
  merge(fromId: string, intoId: string, byAgent: boolean, verb: "Merged" | "Folded" = "Merged"): TopicSummary {
    const from = this.require(fromId);
    const into = this.require(intoId);
    if (from.id === into.id) throw new TopicStoreError("A topic cannot be merged into itself.");
    if (from.space !== into.space) throw new TopicStoreError("Topics of different spaces cannot be merged.");
    const questIds = this.questsOf(from.id);
    const undo: Undo = { kind: "merge", from: structuredClone(from), intoId, intoAliases: [...into.aliases], questIds };
    for (const questId of questIds) this.s().questTopics[questId] = into.id;
    for (const alias of [from.name, ...from.aliases]) {
      if (normalizeName(alias) !== normalizeName(into.name) && !into.aliases.includes(alias)) into.aliases.push(alias);
    }
    // Events the merged topic's page took in stay taken in: the merging Scribe carries that page over.
    // (Other leaders' Scribes, whose events these may be, never hear of them again.)
    const waiting = new Set(pendingOf(from));
    const moved = from.events.map((event) => (waiting.has(event) ? event : { ...event, covered: true }));
    into.events = [...into.events, ...moved].sort((a, b) => a.at - b.at).slice(-MAX_EVENTS_PER_TOPIC);
    if (from.now?.length) into.now = [...(into.now ?? []), ...from.now];
    into.updatedAt = this.now();
    from.mergedInto = into.id;
    this.addEvent(into.id, {
      at: this.now(),
      kind: "message",
      text: `${verb} "${from.name}" into this topic`,
      ...(byAgent ? { byScribe: true } : {}),
    });
    this.recordChange(into.space, `${verb} "${from.name}" into "${into.name}"`, byAgent, undo);
    this.dirty = true;
    return this.summary(into);
  }

  /** Files a quest under another topic, existing (by ID) or new (by name). */
  move(questId: string, target: { topicId?: string; name?: string }, space: string, byAgent: boolean): TopicSummary {
    if (target.topicId) {
      const topic = this.require(target.topicId);
      return this.assign({ questId, space: topic.space, name: topic.name, by: topic.nameSource, byAgent }).topic;
    }
    if (!target.name) throw new TopicStoreError("Name the topic to move the quest to.");
    return this.assign({ questId, space, name: target.name, by: byAgent ? "agent" : "user", byAgent }).topic;
  }

  /** Reverts a change; later changes to the same topics are kept. */
  undo(changeId: string): TopicChange {
    const change = this.s().changes.find((candidate) => candidate.id === changeId);
    if (!change) throw new TopicStoreError("Change not found.", 404);
    if (change.undone) throw new TopicStoreError("This change was already undone.", 409);
    const undo = change.undo;
    // Pages written since the change describe it; their topics get the undo as a fix to make.
    const affected: string[] = [];
    if (undo.kind === "rename") {
      const topic = this.require(undo.topicId);
      topic.aliases = topic.aliases.filter((alias) => alias !== undo.name);
      if (!topic.aliases.includes(topic.name)) topic.aliases.push(topic.name);
      topic.name = undo.name;
      topic.nameSource = undo.nameSource;
    } else if (undo.kind === "merge") {
      const into = this.s().topics[undo.intoId];
      this.s().topics[undo.from.id] = structuredClone(undo.from);
      for (const questId of undo.questIds) {
        if (this.s().questTopics[questId] === undo.intoId) this.s().questTopics[questId] = undo.from.id;
      }
      affected.push(undo.from.id, undo.intoId);
      if (into) {
        into.aliases = undo.intoAliases;
        const fromEventKeys = new Set(undo.from.events.map(eventKey));
        into.events = into.events.filter((event) => !fromEventKeys.has(eventKey(event)));
        const fromNow = new Set((undo.from.now ?? []).map((entry) => entry.id));
        if (into.now) into.now = into.now.filter((entry) => !fromNow.has(entry.id));
      }
    } else {
      const movedTo = this.s().questTopics[undo.questId];
      if (movedTo && movedTo !== undo.createdTopicId) affected.push(movedTo);
      if (undo.fromTopicId) affected.push(undo.fromTopicId);
      if (undo.fromTopicId) this.s().questTopics[undo.questId] = undo.fromTopicId;
      else delete this.s().questTopics[undo.questId];
      if (undo.createdTopicId && this.questsOf(undo.createdTopicId).length === 0) {
        delete this.s().topics[undo.createdTopicId];
      }
    }
    for (const topicId of affected) {
      if (this.s().topics[topicId]?.page) {
        this.addEvent(topicId, { at: this.now(), kind: "undone", text: `The user undid: ${change.text}` });
      }
    }
    change.undone = true;
    this.dirty = true;
    return publicChange(change);
  }

  // ─── Events and pages ─────────────────────────────────────────────────────

  addEvent(topicId: string, event: TopicEvent): void {
    let topic = this.live(topicId);
    if (!topic) return;
    if (topic.thread) {
      // Writing in a settled thread makes it active again; a filed thread's news is its topic's.
      if (event.kind === "message") {
        topic.thread.lastMessageAt = event.at;
        delete topic.thread.settledAt;
        delete topic.thread.sortAskedAt;
        this.dirty = true;
        this.onThreadChange?.(topic.thread.leaderId);
      }
      const under = topic.thread.topicId ? this.live(topic.thread.topicId) : undefined;
      if (!under) return;
      topic = under;
    }
    const state = this.s();
    state.eventSeq = (state.eventSeq ?? 0) + 1;
    topic.events.push({ ...event, seq: state.eventSeq });
    if (topic.events.length > MAX_EVENTS_PER_TOPIC) topic.events.splice(0, topic.events.length - MAX_EVENTS_PER_TOPIC);
    this.dirty = true;
  }

  /**
   * Events the page does not include yet; with `leaderId`, only that leader's (and events of no
   * leader), as its Scribe handles them.
   */
  pendingEvents(topicId: string, leaderId?: string): TopicEvent[] {
    return pendingOf(this.require(topicId), leaderId);
  }

  /**
   * Compares the images a page shows (and their folders) with what Scribes were told: `stats` has
   * each image's current modification time (null when gone), `folders` the images found beside them.
   * Returns what changed since, and records it as told: a picture redrawn after it was last
   * reported, or first seen newer than the page's text; an image in a folder changed since the folder
   * was last looked at (on the first look, at least as new as the pictures the page shows there).
   */
  notePictures(
    topicId: string,
    stats: Record<string, number | null>,
    folders: Record<string, Array<{ path: string; mtimeMs: number }>>,
  ): { redrawn: Array<{ path: string; mtimeMs: number }>; added: Array<{ path: string; mtimeMs: number }> } {
    const topic = this.require(topicId);
    const seen = (topic.pictures ??= {});
    const textAt = topic.writtenAt ?? 0;
    const redrawn: Array<{ path: string; mtimeMs: number }> = [];
    for (const [path, mtimeMs] of Object.entries(stats)) {
      if (mtimeMs === null) continue;
      const before = seen[path];
      if (before === undefined ? mtimeMs > textAt : mtimeMs > before) redrawn.push({ path, mtimeMs });
      if (before !== mtimeMs) {
        seen[path] = mtimeMs;
        this.dirty = true;
      }
    }
    const added: Array<{ path: string; mtimeMs: number }> = [];
    const lookedAt = (topic.pictureFolders ??= {});
    for (const [folder, images] of Object.entries(folders)) {
      // First look at a folder: images at least as new as the ones the page shows there are offered.
      const shown = images.filter((image) => stats[image.path] != null).map((image) => image.mtimeMs);
      const since = lookedAt[folder] ?? (shown.length ? Math.min(...shown) : textAt);
      for (const image of images) {
        if (!(image.path in stats) && image.mtimeMs > since) added.push(image);
      }
      const newest = Math.max(since, ...images.map((image) => image.mtimeMs));
      if (lookedAt[folder] !== newest) {
        lookedAt[folder] = newest;
        this.dirty = true;
      }
    }
    return { redrawn, added };
  }

  /** The topic's pictures redrawn after its text: picture events no page write covered yet. */
  picturesNewerThanText(topicId: string): boolean {
    return pendingOf(this.require(topicId)).some((event) => event.kind === "picture");
  }

  /** The leader whose Scribe last wrote the page (the one that covered events latest), if known. */
  pageWriter(topicId: string): string | undefined {
    const covered = Object.entries(this.require(topicId).coveredThrough ?? {});
    return covered.sort((a, b) => b[1] - a[1])[0]?.[0];
  }

  /** When a Scribe last saved the page or confirmed it needs no change. */
  pageTouchedAt(topicId: string): number {
    const topic = this.require(topicId);
    return Math.max(topic.writtenAt ?? 0, topic.checkedAt ?? 0);
  }

  pageRevision(topicId: string): number {
    return this.require(topicId).pageRevision ?? 0;
  }

  /**
   * Saves a page that covers the Scribe's leader's events up to `upToDateAt`. With `revision`,
   * the write is refused when another Scribe saved the page since this one read it.
   */
  writePage(
    topicId: string,
    markdown: string,
    upToDateAt: number,
    options: { leaderId?: string; revision?: number } = {},
  ): TopicDetail {
    const topic = this.require(topicId);
    if (!markdown.trim()) throw new TopicStoreError("The page is empty.");
    if (options.revision !== undefined && options.revision !== (topic.pageRevision ?? 0)) {
      throw new TopicStoreError(
        "The page changed since you read it (another leader's Scribe saved it). Run `takode scribe changes` again and merge your update into the current page.",
        409,
      );
    }
    topic.page = markdown;
    if (options.leaderId) {
      topic.coveredThrough = {
        ...topic.coveredThrough,
        [options.leaderId]: Math.max(upToDateAt, topic.coveredThrough?.[options.leaderId] ?? 0),
      };
    } else {
      topic.coveredThrough = undefined;
    }
    topic.upToDateAt = Math.max(upToDateAt, topic.upToDateAt ?? 0);
    topic.pageRevision = (topic.pageRevision ?? 0) + 1;
    topic.writtenAt = this.now();
    topic.updatedAt = this.now();
    this.dirty = true;
    return this.detail(topic.id);
  }

  /**
   * The topic's Now entries, oldest first, with their latest news (an edit, or an event of a quest
   * they link). Entries the user marked done stay a day, so Undo works.
   */
  nowEntries(topicId: string): NowEntry[] {
    const topic = this.require(topicId);
    return (topic.now ?? [])
      .filter((entry) => entry.doneAt === undefined || this.now() - entry.doneAt <= DONE_KEPT_MS)
      .map((entry) => {
        const questIds = questLinksOf(entry.text);
        const questNews = topic.events
          .filter((event) => event.questId && questIds.includes(event.questId))
          .reduce((latest, event) => Math.max(latest, event.at), 0);
        const { changedAt, ...rest } = entry;
        return { ...rest, questIds, lastNews: Math.max(changedAt, questNews) };
      });
  }

  /** A Scribe adds a Now entry for its leader's work. */
  addNow(topicId: string, input: NowInput & { leaderId?: string }): NowEntry {
    const topic = this.require(topicId);
    const entry: StoredNowEntry = {
      id: randomUUID().replace(/-/g, "").slice(0, 6),
      ...checkNow(input),
      ...(input.leaderId ? { leaderId: input.leaderId } : {}),
      since: this.now(),
      changedAt: this.now(),
    };
    topic.now = [...this.prunedNow(topic), entry];
    this.nowChanged(topic);
    return this.nowEntries(topic.id).find((candidate) => candidate.id === entry.id)!;
  }

  /** A Scribe rewords or regroups a Now entry; it keeps its date. */
  editNow(topicId: string, id: string, patch: Partial<NowInput>): NowEntry {
    const topic = this.require(topicId);
    const entry = this.nowEntry(topic, id);
    const next = checkNow({ group: entry.group, who: entry.who, text: entry.text, due: entry.due, ...patch });
    for (const field of ["who", "due"] as const) if (!next[field]) delete entry[field];
    Object.assign(entry, next, { changedAt: this.now() });
    this.nowChanged(topic);
    return this.nowEntries(topic.id).find((candidate) => candidate.id === id)!;
  }

  /** A Scribe removes a Now entry that is done or no longer matters; returns its text. */
  removeNow(topicId: string, id: string): string {
    const topic = this.require(topicId);
    const entry = this.nowEntry(topic, id);
    topic.now = (topic.now ?? []).filter((candidate) => candidate.id !== id);
    this.nowChanged(topic);
    return entry.text;
  }

  /** The user marked a Now entry done on the page, or took that back; returns its text. */
  markNowDone(topicId: string, id: string, done = true): string {
    const topic = this.require(topicId);
    const entry = this.nowEntry(topic, id);
    if (done) entry.doneAt = this.now();
    else delete entry.doneAt;
    this.nowChanged(topic);
    return entry.text;
  }

  private nowEntry(topic: StoredTopic, id: string): StoredNowEntry {
    const entry = topic.now?.find((candidate) => candidate.id === id);
    if (!entry)
      throw new TopicStoreError(`No Now entry ${id} on "${topic.name}"; \`takode scribe changes\` lists them.`, 404);
    return entry;
  }

  /** Entries marked done more than a day ago are dropped. */
  private prunedNow(topic: StoredTopic): StoredNowEntry[] {
    return (topic.now ?? []).filter((entry) => entry.doneAt === undefined || this.now() - entry.doneAt <= DONE_KEPT_MS);
  }

  private nowChanged(topic: StoredTopic): void {
    topic.updatedAt = this.now();
    this.dirty = true;
  }

  /**
   * Merges before Oct 29 left events that a merged-in topic's page had taken in waiting on the
   * topic they moved to, where only their own leader's Scribe could clear them (often never): they
   * are marked taken in, as merges now do.
   */
  private coverMergedEvents(): void {
    const topics = Object.values(this.s().topics);
    // A topic merged into one that was merged further passes its events on: repeat until settled.
    for (let pass = 0, changed = true; changed && pass < 5; pass += 1) {
      changed = false;
      for (const from of topics) {
        const into = from.mergedInto ? this.s().topics[from.mergedInto] : undefined;
        if (!into) continue;
        const waiting = new Set(pendingOf(from).map(eventKey));
        const takenIn = new Set(from.events.map(eventKey).filter((key) => !waiting.has(key)));
        into.events = into.events.map((event) => {
          if (event.covered || !takenIn.has(eventKey(event))) return event;
          changed = true;
          return { ...event, covered: true };
        });
      }
      if (changed) this.dirty = true;
    }
  }

  /**
   * Pages written before Now was kept as entries: their Now bullets become entries (dated as the
   * page tracked them, else from its save, and credited to the one leader whose Scribe wrote the
   * page, if only one did), and the section leaves the page.
   */
  private moveNowOffPage(topic: StoredTopic): void {
    if (topic.now) return;
    const legacy = takeLegacyNow(topic.page);
    if (!legacy) return;
    const leaders = Object.keys(topic.coveredThrough ?? {});
    const tracked = Object.values(topic.nowItems ?? {});
    const at = topic.writtenAt ?? topic.updatedAt;
    topic.now = legacy.items.map((item) => {
      const dated = tracked.find((stored) => stored.text.endsWith(item.text));
      return {
        id: randomUUID().replace(/-/g, "").slice(0, 6),
        ...item,
        ...(leaders.length === 1 ? { leaderId: leaders[0] } : {}),
        since: dated?.since ?? at,
        changedAt: dated?.changedAt ?? at,
      };
    });
    topic.page = legacy.page;
    delete topic.nowItems;
    this.dirty = true;
  }

  /**
   * The retired "Waiting on you" group: open questions to the user now come from the notifications
   * of the topic's quests, and what Scribes kept there are optional follow-ups.
   */
  private retireWaitingOnYou(topic: StoredTopic): void {
    for (const entry of topic.now ?? []) {
      if ((entry.group as string) !== "you") continue;
      entry.group = "followup";
      this.dirty = true;
    }
  }

  /** The leader's events up to `upToDateAt` need nothing on the page: they count as covered. */
  markCovered(topicId: string, upToDateAt: number, leaderId: string): void {
    const topic = this.require(topicId);
    topic.checkedAt = this.now();
    topic.coveredThrough = {
      ...topic.coveredThrough,
      [leaderId]: Math.max(upToDateAt, topic.coveredThrough?.[leaderId] ?? 0),
    };
    this.dirty = true;
  }

  // ─── Reads ────────────────────────────────────────────────────────────────

  /** A live topic by ID, unique ID prefix, or name in the given space. */
  resolve(ref: string, space?: string): StoredTopic | undefined {
    // A thread key names its topic too (`topic:<handle>`).
    if (/^topic:[0-9a-f]/i.test(ref)) ref = ref.slice("topic:".length);
    const topics = this.s().topics;
    const direct = topics[ref];
    if (direct) return this.live(direct.id);
    if (ref.length >= 4) {
      const matches = Object.keys(topics).filter((id) => id.startsWith(ref) && !topics[id].mergedInto);
      if (matches.length === 1) return topics[matches[0]];
    }
    if (space) return this.findByName(space, ref);
    const byName = Object.values(topics).filter(
      (topic) => !topic.mergedInto && normalizeName(topic.name) === normalizeName(ref),
    );
    return byName.length === 1 ? byName[0] : undefined;
  }

  /**
   * The live topic a thread handle names (`topic-thread-key.ts`): the topic whose ID starts with it,
   * or the topic it was merged into.
   */
  resolveHandle(handle: string): StoredTopic | undefined {
    const key = topicHandle(handle);
    const id = Object.keys(this.s().topics).find((candidate) => topicHandle(candidate) === key);
    return id ? this.live(id) : undefined;
  }

  /** The handles whose threads a live topic's conversation shows: its own and those merged into it. */
  handlesOf(topicId: string): string[] {
    return Object.values(this.s().topics)
      .filter((topic) => this.live(topic.id)?.id === topicId)
      .map((topic) => topicHandle(topic.id));
  }

  /** Topics, most recent activity first (page rewrites don't count as activity). */
  list(space?: string): TopicSummary[] {
    return this.liveTopics(space)
      .map((topic) => this.summary(topic))
      .sort((a, b) => b.activityAt - a.activityAt);
  }

  spaces(): string[] {
    return [...new Set(this.liveTopics().map((topic) => topic.space))].sort();
  }

  detail(topicId: string): TopicDetail {
    const topic = this.require(topicId);
    return {
      ...this.summary(topic),
      aliases: [...topic.aliases],
      page: topic.page,
      writtenAt: topic.writtenAt ?? null,
      instructions: topic.instructions?.text ?? "",
      events: [...topic.events],
    };
  }

  /** Saves the user's lasting requests for a topic's page (replacing them); returns the saved text. */
  setTopicInstructions(topicId: string, text: string): string {
    const topic = this.require(topicId);
    const clean = text.trim().slice(0, 4000);
    topic.instructions = clean ? { text: clean, updatedAt: this.now() } : undefined;
    this.dirty = true;
    return clean;
  }

  /**
   * The changes the panel still offers to undo, newest first: made in the last day, not undone and
   * not dismissed. Older ones go away on their own; tidying stays undoable while it is news.
   */
  changes(space?: string, limit = 20): TopicChange[] {
    const since = this.now() - CHANGE_SHOWN_MS;
    return this.s()
      .changes.filter(
        (change) => (!space || change.space === space) && !change.undone && !change.dismissed && change.at >= since,
      )
      .slice(-limit)
      .reverse()
      .map(publicChange);
  }

  /** Takes changes out of the panel without undoing them. */
  dismissChanges(changeIds: string[]): void {
    for (const change of this.s().changes) {
      if (changeIds.includes(change.id)) change.dismissed = true;
    }
    this.dirty = true;
  }

  summary(topic: StoredTopic): TopicSummary {
    const questIds = this.questsOf(topic.id);
    return {
      id: topic.id,
      space: topic.space,
      name: topic.name,
      nameSource: topic.nameSource,
      tentative:
        topic.nameSource !== "user" && questIds.length < 2 && this.now() - topic.createdAt < TOPIC_TENTATIVE_MS,
      createdAt: topic.createdAt,
      updatedAt: topic.updatedAt,
      questIds,
      summary: pageSummary(topic.page),
      upToDateAt: topic.upToDateAt,
      // A done mark is already on the page (taken off it), so it is not waiting for a Scribe.
      pendingEvents: pendingOf(topic).filter((event) => event.kind !== "now_done").length,
      ...activityOf(topic),
      ...(latestHistoryLine(topic.page) ? { latestUpdate: latestHistoryLine(topic.page) } : {}),
      openNow: this.prunedNow(topic).filter((entry) => entry.doneAt === undefined).length,
      ...(this.threadRefs(topic.id).length ? { threads: this.threadRefs(topic.id) } : {}),
    };
  }

  private threadRefs(topicId: string): TopicThreadRef[] {
    return this.threadsUnder(topicId).map((thread) => ({ handle: topicHandle(thread.id), name: thread.name }));
  }

  /** Whether the user undid a merge or fold of this topic: a Scribe should not redo it. */
  userUndidMerge(topicId: string): boolean {
    return this.s().changes.some(
      (change) => change.undone && change.undo.kind === "merge" && change.undo.from.id === topicId,
    );
  }

  /** Agent-named topics a day old that nothing joined: candidates to fold into a better topic. */
  foldCandidates(space: string): TopicSummary[] {
    return this.liveTopics(space)
      .filter(
        (topic) =>
          topic.nameSource !== "user" &&
          !this.userUndidMerge(topic.id) &&
          this.questsOf(topic.id).length < 2 &&
          this.now() - topic.createdAt >= TOPIC_TENTATIVE_MS,
      )
      .map((topic) => this.summary(topic));
  }

  flush(): Promise<void> {
    if (!this.dirty || !this.state) return this.writeChain;
    this.dirty = false;
    const json = JSON.stringify(this.state);
    this.writeChain = this.writeChain
      .then(async () => {
        await mkdir(this.root, { recursive: true });
        const tempPath = join(this.root, "topics.json.tmp");
        await writeFile(tempPath, json, "utf-8");
        await rename(tempPath, join(this.root, "topics.json"));
      })
      .catch((error) => console.error("[library-topics] Failed to write topics:", error));
    return this.writeChain;
  }

  private createTopic(space: string, name: string, by: TopicNameSource): StoredTopic {
    const now = this.now();
    // A topic's thread is named by the first 8 hex digits of its ID, so they must be unique.
    const taken = new Set(Object.keys(this.s().topics).map(topicHandle));
    let id = randomUUID();
    while (taken.has(topicHandle(id))) id = randomUUID();
    const topic: StoredTopic = {
      id,
      space,
      name,
      nameSource: by,
      aliases: [],
      createdAt: now,
      updatedAt: now,
      page: null,
      upToDateAt: null,
      writtenAt: null,
      events: [],
    };
    this.s().topics[topic.id] = topic;
    return topic;
  }

  private recordChange(space: string, text: string, byAgent: boolean, undo: Undo): void {
    const changes = this.s().changes;
    changes.push({ id: randomUUID(), at: this.now(), space, text, byAgent, undone: false, undo });
    if (changes.length > MAX_CHANGES) changes.splice(0, changes.length - MAX_CHANGES);
  }

  /** Live topics, threads left out (they are stored here but are not topics). */
  private liveTopics(space?: string): StoredTopic[] {
    return Object.values(this.s().topics).filter(
      (topic) => !topic.mergedInto && !topic.thread && (!space || topic.space === space),
    );
  }

  private live(id: string): StoredTopic | undefined {
    let topic = this.s().topics[id];
    // A merged topic's quests and links lead to the topic it went into.
    for (let hops = 0; topic?.mergedInto && hops < 10; hops += 1) topic = this.s().topics[topic.mergedInto];
    return topic && !topic.mergedInto ? topic : undefined;
  }

  private require(id: string): StoredTopic {
    const topic = this.live(id);
    if (!topic) throw new TopicStoreError("Topic not found.", 404);
    return topic;
  }

  private s(): TopicState {
    if (!this.state) throw new Error("Topic store is not loaded");
    return this.state;
  }

  private scribeRecord(leaderId: string): StoredScribe {
    const scribes = (this.s().scribes ??= {});
    scribes[leaderId] ??= {};
    return scribes[leaderId];
  }
}

/**
 * Events a page does not cover. Each leader's coverage counts for its own events; events of no
 * leader (older ones) count as covered by any write.
 */
function pendingOf(topic: StoredTopic, leaderId?: string): TopicEvent[] {
  const none = Number.NEGATIVE_INFINITY;
  // Pages written before per-leader coverage cover everyone's events up to `upToDateAt`.
  const covered = (leader: string | undefined) =>
    leader && topic.coveredThrough ? (topic.coveredThrough[leader] ?? none) : (topic.upToDateAt ?? none);
  return topic.events.filter((event) => {
    if (event.covered) return false;
    if (leaderId && event.leaderId && event.leaderId !== leaderId) return false;
    return event.at > covered(event.leaderId);
  });
}

function cleanName(name: string): string {
  const clean = name.replace(/\s+/g, " ").trim().slice(0, 80);
  if (!clean) throw new TopicStoreError("A topic needs a name.");
  return clean;
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, " ").trim();
}

function eventKey(event: TopicEvent): string {
  return `${event.at}|${event.kind}|${event.questId ?? ""}|${event.messageIndex ?? ""}`;
}

/** A Now entry as a command gives it. */
interface NowInput {
  group: NowGroup;
  who?: string;
  text: string;
  /** "YYYY-MM-DD". */
  due?: string;
}

function checkNow(input: NowInput): NowInput {
  if (!NOW_GROUPS.includes(input.group)) {
    throw new TopicStoreError(`Unknown group "${input.group}"; use one of ${NOW_GROUPS.join(", ")}.`);
  }
  const text = input.text.trim();
  if (!text) throw new TopicStoreError("Say what the item is.");
  const who = input.who?.trim();
  if (input.group === "waiting" && !who) throw new TopicStoreError("Say whom it waits on (--who).");
  if (input.due && !/^\d{4}-\d{2}-\d{2}$/.test(input.due))
    throw new TopicStoreError("Give the due date as YYYY-MM-DD.");
  return {
    group: input.group,
    text,
    ...(input.group === "waiting" && who ? { who } : {}),
    ...(input.due ? { due: input.due } : {}),
  };
}

function publicChange(change: StoredChange): TopicChange {
  const { undo: _undo, dismissed: _dismissed, ...rest } = change;
  return rest;
}

/** The page's one-sentence lead (text before its first heading), else "Where it stands", else its first paragraph. */
/** What happened last in a topic: its newest event that is news (not a Scribe's own tidying). */
function activityOf(topic: StoredTopic): Pick<TopicSummary, "activityAt" | "latestActivity"> {
  const latest = topic.events
    .filter(
      (event) =>
        !event.byScribe && event.kind !== "now_done" && event.kind !== "page_request" && event.kind !== "picture",
    )
    .reduce<TopicEvent | null>((newest, event) => (!newest || event.at >= newest.at ? event : newest), null);
  // Events exist only since topics were turned on; the route adds the quests' own changes.
  if (!latest) return { activityAt: 0 };
  const quest = latest.questId ?? "";
  const text =
    latest.kind === "quest_done"
      ? `${quest} finished`
      : latest.kind === "quest_filed"
        ? `${quest} filed here`
        : latest.kind === "message"
          ? quest
            ? `You wrote in ${quest}`
            : plainLine(latest.text ?? "")
          : latest.kind === "artifact"
            ? `${plainLine(latest.text ?? "")} saved`
            : latest.kind === "check"
              ? `A check was ticked in ${quest}`
              : latest.kind === "note"
                ? `Note on ${quest}`
                : plainLine(latest.text ?? "");
  return {
    activityAt: latest.at,
    latestActivity: { at: latest.at, text, ...(latest.questId ? { questId: latest.questId } : {}) },
  };
}

/** The first line under the page's History (or older Recent) heading, as plain text. */
function latestHistoryLine(page: string | null): string | undefined {
  const section = /^##\s+(?:History|Recent)\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/im.exec(page ?? "");
  const line = section?.[1]?.split("\n").find((candidate) => /^[-*]\s+/.test(candidate));
  return line ? plainLine(line.replace(/^[-*]\s+/, "")) : undefined;
}

/** Markdown in one plain line: link labels kept, emphasis dropped, capped. */
function plainLine(markdown: string): string {
  const plain = markdown
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > 240 ? `${plain.slice(0, 239).trimEnd()}…` : plain;
}

export function pageSummary(page: string | null): string {
  if (!page) return "";
  // The page opens with its one-sentence summary; older pages lead with "Where it stands".
  const lead = page.startsWith("#")
    ? ""
    : page
        .split(/\n#/)[0]!
        .trim()
        .split(/\n\s*\n/)[0]!;
  const section = /^#+\s*where it stands\s*\n+([\s\S]*?)(?:\n#|\n\s*\n|$)/im.exec(page);
  const text =
    (lead || undefined) ??
    section?.[1] ??
    page
      .replace(/^#.*$/gm, "")
      .trim()
      .split(/\n\s*\n/)[0] ??
    "";
  const plain = text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > 240 ? `${plain.slice(0, 239).trimEnd()}…` : plain;
}
