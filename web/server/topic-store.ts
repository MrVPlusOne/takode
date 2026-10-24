import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  TOPIC_TENTATIVE_MS,
  type QuestTopicMap,
  type TopicChange,
  type TopicDetail,
  type TopicEvent,
  type TopicNameSource,
  type TopicSummary,
} from "../shared/library-topics.js";

/**
 * Library topics on disk (`topics.json` beside the artifact library): topics per session space,
 * which topic each quest is filed under, each topic's page and the events since it was written,
 * the per-leader switch, the per-space pause, and the change list whose entries can be undone.
 * Writes are whole-file and atomic, chained so they land in order.
 */

const MAX_EVENTS_PER_TOPIC = 200;
const MAX_CHANGES = 300;

interface StoredTopic {
  id: string;
  space: string;
  name: string;
  nameSource: TopicNameSource;
  aliases: string[];
  createdAt: number;
  updatedAt: number;
  page: string | null;
  upToDateAt: number | null;
  writtenAt: number | null;
  events: TopicEvent[];
  /** Set when merged or folded into another topic; such a topic is hidden. */
  mergedInto?: string;
}

type Undo =
  | { kind: "rename"; topicId: string; name: string; nameSource: TopicNameSource }
  | { kind: "merge"; from: StoredTopic; intoId: string; intoAliases: string[]; questIds: string[] }
  | { kind: "move"; questId: string; fromTopicId: string | null; createdTopicId?: string };

interface StoredChange extends TopicChange {
  undo: Undo;
}

interface TopicState {
  version: 1;
  topics: Record<string, StoredTopic>;
  questTopics: Record<string, string>;
  enabledLeaders: Record<string, { enabledAt: number; backfilledAt?: number }>;
  hintDismissed: Record<string, number>;
  paused: Record<string, boolean>;
  /** Hidden session that writes a space's pages. */
  writers: Record<string, string>;
  /** Per leader: history messages already read for events. */
  cursors: Record<string, number>;
  changes: StoredChange[];
  /** Per space: what replaced page writers spent in their last day, so the budget still counts it. */
  retiredSpend?: Record<string, Array<{ at: number; amount: number }>>;
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
        hintDismissed: {},
        paused: {},
        writers: {},
        cursors: {},
        changes: [],
      };
    }
  }

  get loaded(): boolean {
    return this.state !== null;
  }

  // ─── Leaders, pause, page writers ─────────────────────────────────────────

  isLeaderEnabled(sessionId: string): boolean {
    return !!this.s().enabledLeaders[sessionId];
  }

  enabledLeaderIds(): string[] {
    return Object.keys(this.s().enabledLeaders);
  }

  /** Turns topics on or off for a leader; returns whether the leader still needs its month backfilled. */
  setLeaderEnabled(sessionId: string, enabled: boolean): { needsBackfill: boolean } {
    const leaders = this.s().enabledLeaders;
    if (!enabled) {
      if (leaders[sessionId]) {
        delete leaders[sessionId];
        this.dirty = true;
      }
      return { needsBackfill: false };
    }
    leaders[sessionId] ??= { enabledAt: this.now() };
    this.dirty = true;
    return { needsBackfill: !leaders[sessionId].backfilledAt };
  }

  markBackfilled(sessionId: string): void {
    const leader = this.s().enabledLeaders[sessionId];
    if (!leader) return;
    leader.backfilledAt = this.now();
    this.dirty = true;
  }

  dismissHint(sessionId: string): void {
    this.s().hintDismissed[sessionId] = this.now();
    this.dirty = true;
  }

  hintDismissed(sessionId: string): boolean {
    return !!this.s().hintDismissed[sessionId];
  }

  isPaused(space: string): boolean {
    return !!this.s().paused[space];
  }

  setPaused(space: string, paused: boolean): void {
    if (paused) this.s().paused[space] = true;
    else delete this.s().paused[space];
    this.dirty = true;
  }

  writerFor(space: string): string | undefined {
    return this.s().writers[space];
  }

  setWriter(space: string, sessionId: string): void {
    this.s().writers[space] = sessionId;
    this.dirty = true;
  }

  /** Keeps a replaced writer's recent spend in the space's budget for a day. */
  recordRetiredSpend(space: string, amount: number): void {
    const state = this.s();
    state.retiredSpend ??= {};
    state.retiredSpend[space] = [...(state.retiredSpend[space] ?? []), { at: this.now(), amount }];
    this.dirty = true;
  }

  retiredSpend(space: string, since: number): number {
    const entries = this.s().retiredSpend?.[space] ?? [];
    const recent = entries.filter((entry) => entry.at >= since);
    if (recent.length !== entries.length) {
      this.s().retiredSpend![space] = recent;
      this.dirty = true;
    }
    return recent.reduce((sum, entry) => sum + entry.amount, 0);
  }

  spaceOfWriter(sessionId: string): string | undefined {
    return Object.entries(this.s().writers).find(([, id]) => id === sessionId)?.[0];
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
  assign(input: { questId: string; space: string; name: string; by: TopicNameSource; byAgent: boolean }): {
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
    this.addEvent(topic.id, { at: this.now(), kind: "quest_filed", questId: input.questId });
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
    return this.summary(topic);
  }

  /** Moves every quest of `fromId` into `intoId`; "fold" is the same for a tentative topic nothing joined. */
  merge(fromId: string, intoId: string, byAgent: boolean, verb: "Merged" | "Folded" = "Merged"): TopicSummary {
    const from = this.require(fromId);
    const into = this.require(intoId);
    if (from.id === into.id) throw new TopicStoreError("A topic cannot be merged into itself.");
    if (from.space !== into.space) throw new TopicStoreError("Topics of different spaces cannot be merged.");
    if (byAgent && this.userUndidMerge(from.id)) {
      throw new TopicStoreError(`The user undid merging "${from.name}" before; leave it as its own topic.`, 409);
    }
    const questIds = this.questsOf(from.id);
    const undo: Undo = { kind: "merge", from: structuredClone(from), intoId, intoAliases: [...into.aliases], questIds };
    for (const questId of questIds) this.s().questTopics[questId] = into.id;
    for (const alias of [from.name, ...from.aliases]) {
      if (normalizeName(alias) !== normalizeName(into.name) && !into.aliases.includes(alias)) into.aliases.push(alias);
    }
    into.events = [...into.events, ...from.events].sort((a, b) => a.at - b.at).slice(-MAX_EVENTS_PER_TOPIC);
    into.updatedAt = this.now();
    from.mergedInto = into.id;
    this.addEvent(into.id, { at: this.now(), kind: "message", text: `${verb} "${from.name}" into this topic` });
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
        this.addEvent(topicId, { at: this.now(), kind: "feedback", text: `The user undid: ${change.text}` });
      }
    }
    change.undone = true;
    this.dirty = true;
    return publicChange(change);
  }

  // ─── Events and pages ─────────────────────────────────────────────────────

  addEvent(topicId: string, event: TopicEvent): void {
    const topic = this.live(topicId);
    if (!topic) return;
    topic.events.push(event);
    if (topic.events.length > MAX_EVENTS_PER_TOPIC) topic.events.splice(0, topic.events.length - MAX_EVENTS_PER_TOPIC);
    this.dirty = true;
  }

  /** Events the page does not include yet. */
  pendingEvents(topicId: string): TopicEvent[] {
    const topic = this.require(topicId);
    return topic.events.filter((event) => topic.upToDateAt === null || event.at > topic.upToDateAt);
  }

  writePage(topicId: string, markdown: string, upToDateAt: number): TopicDetail {
    const topic = this.require(topicId);
    if (!markdown.trim()) throw new TopicStoreError("The page is empty.");
    topic.page = markdown;
    topic.upToDateAt = Math.max(upToDateAt, topic.upToDateAt ?? 0);
    topic.writtenAt = this.now();
    topic.updatedAt = this.now();
    this.dirty = true;
    return this.detail(topic.id);
  }

  // ─── Reads ────────────────────────────────────────────────────────────────

  /** A live topic by ID, unique ID prefix, or name in the given space. */
  resolve(ref: string, space?: string): StoredTopic | undefined {
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

  list(space?: string): TopicSummary[] {
    return this.liveTopics(space)
      .map((topic) => this.summary(topic))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  spaces(): string[] {
    return [...new Set(this.liveTopics().map((topic) => topic.space))].sort();
  }

  detail(topicId: string): TopicDetail {
    const topic = this.require(topicId);
    return { ...this.summary(topic), aliases: [...topic.aliases], page: topic.page, events: [...topic.events] };
  }

  changes(space?: string, limit = 20): TopicChange[] {
    return this.s()
      .changes.filter((change) => !space || change.space === space)
      .slice(-limit)
      .reverse()
      .map(publicChange);
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
      pendingEvents: topic.events.filter((event) => topic.upToDateAt === null || event.at > topic.upToDateAt).length,
    };
  }

  /** Agent-named topics a day old that nothing joined: candidates to fold into a better topic. */
  /** Whether the user undid a merge or fold of this topic: the page writer must not redo it. */
  private userUndidMerge(topicId: string): boolean {
    return this.s().changes.some(
      (change) => change.undone && change.undo.kind === "merge" && change.undo.from.id === topicId,
    );
  }

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
    const topic: StoredTopic = {
      id: randomUUID(),
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

  private liveTopics(space?: string): StoredTopic[] {
    return Object.values(this.s().topics).filter((topic) => !topic.mergedInto && (!space || topic.space === space));
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

function publicChange(change: StoredChange): TopicChange {
  const { undo: _undo, ...rest } = change;
  return rest;
}

/** The first paragraph of the page's "Where it stands" section, or of the page. */
export function pageSummary(page: string | null): string {
  if (!page) return "";
  const section = /^#+\s*where it stands\s*\n+([\s\S]*?)(?:\n#|\n\s*\n|$)/im.exec(page);
  const text =
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
