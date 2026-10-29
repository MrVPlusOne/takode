import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { BrowserIncomingMessage } from "./session-types.js";
import type { QuestmasterTask } from "./quest-types.js";
import { CHANGE_SHOWN_MS, TopicStore, pageSummary } from "./topic-store.js";
import { PAGE_FORMAT, TopicService, historyMessageText, type TopicSessionLike } from "./topic-service.js";
import { TOPIC_TENTATIVE_MS, type TopicRenameSuggestion } from "../shared/library-topics.js";

/**
 * Library topics on disposable state: filing quests under topics in the user's words, tentative
 * topics, renames that never touch a name the user chose, merges and moves with Undo, and the
 * leader's Scribe being told what changed as soon as it is idle, and not while paused.
 */

const NOW = Date.UTC(2026, 9, 23, 19, 0);
const DAY = 24 * 60 * 60 * 1000;
let root: string;
let now = NOW;
/** Stores made by the current test: the service saves in the background, so they settle first. */
let stores: TopicStore[] = [];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "library-topics-"));
  now = NOW;
  stores = [];
});

afterEach(async () => {
  vi.useRealTimers();
  // Removing the folder while a background save writes into it fails the removal now and then.
  await Promise.all(stores.map((store) => store.flush()));
  await rm(root, { recursive: true, force: true });
});

async function newStore() {
  const store = new TopicStore(root, () => now);
  stores.push(store);
  await store.load();
  return store;
}

describe("topic store", () => {
  it("files quests under topics by name, keeps new topics tentative until a second quest joins", async () => {
    const store = await newStore();
    const first = store.assign({ questId: "q-1", space: "MSI", name: "T7 run", by: "agent", byAgent: false });
    expect(first).toMatchObject({ created: true, topic: { name: "T7 run", tentative: true } });
    // Same subject, different spacing and case: the same topic.
    const second = store.assign({ questId: "q-2", space: "MSI", name: "t7  Run", by: "agent", byAgent: false });
    expect(second).toMatchObject({ created: false, topic: { tentative: false, questIds: ["q-1", "q-2"] } });
    // Other spaces never share topics.
    expect(store.assign({ questId: "q-3", space: "Takode", name: "T7 run", by: "agent", byAgent: false }).created).toBe(
      true,
    );

    const lonely = store.assign({ questId: "q-4", space: "MSI", name: "One-off", by: "agent", byAgent: false });
    now += TOPIC_TENTATIVE_MS + 1;
    expect(store.foldCandidates("MSI").map((topic) => topic.id)).toEqual([lonely.topic.id]);
  });

  it("never lets a Scribe rename a topic the user named: it suggests, and the user accepts or dismisses", async () => {
    const store = await newStore();
    const { topic } = store.assign({
      questId: "q-1",
      space: "MSI",
      name: "Find 12B duties",
      by: "agent",
      byAgent: false,
    });
    store.rename(topic.id, "T7 run", "user", false);
    expect(() => store.rename(topic.id, "Coding T7", "agent", true)).toThrow(/named by the user/);
    // Renames keep the old name findable.
    expect(store.findByName("MSI", "Find 12B duties")?.name).toBe("T7 run");

    const first = store.suggestRename(
      topic.id,
      "Coding T7",
      "leader",
      "Two runs now share this topic",
    ) as TopicRenameSuggestion;
    expect(store.suggestions("MSI")).toEqual([expect.objectContaining({ topicName: "T7 run", name: "Coding T7" })]);
    store.answerSuggestion(first.id, false);
    expect(store.suggestions("MSI")).toEqual([]);
    // A dismissed name is not suggested again (the Scribe is told why, with no error); another one can
    // be, and accepting renames as the user.
    expect(store.suggestRename(topic.id, "coding  t7", "leader")).toMatchObject({
      skipped: expect.stringContaining("dismissed"),
    });
    const second = store.suggestRename(topic.id, "T7 coding run", "leader") as TopicRenameSuggestion;
    expect(store.answerSuggestion(second.id, true)).toMatchObject({ name: "T7 coding run", nameSource: "user" });
  });

  it("merges, moves and undoes each change", async () => {
    const store = await newStore();
    const t7 = store.assign({ questId: "q-1", space: "MSI", name: "T7 run", by: "agent", byAgent: false }).topic;
    const twin = store.assign({ questId: "q-2", space: "MSI", name: "256K twin", by: "agent", byAgent: false }).topic;
    store.merge(twin.id, t7.id, true, "Folded");
    expect(store.topicOfQuest("q-2")?.id).toBe(t7.id);
    expect(store.list("MSI").map((topic) => topic.name)).toEqual(["T7 run"]);
    const [fold] = store.changes("MSI");
    expect(fold).toMatchObject({ text: 'Folded "256K twin" into "T7 run"', byAgent: true, undone: false });

    store.writePage(t7.id, "## Where it stands\nIncludes the twin.", now);
    now += 1000;
    store.undo(fold.id);
    expect(store.topicOfQuest("q-2")?.name).toBe("256K twin");
    // Takode knows the user undid it (a Scribe that tries again is told so), and it is no longer offered for folding.
    expect(store.userUndidMerge(twin.id)).toBe(true);
    now += TOPIC_TENTATIVE_MS + 1;
    expect(store.foldCandidates("MSI").map((topic) => topic.name)).not.toContain("256K twin");
    now -= TOPIC_TENTATIVE_MS + 1;
    // The page that described the fold is asked to drop it.
    expect(store.pendingEvents(t7.id).map((event) => event.text)).toEqual([
      'The user undid: Folded "256K twin" into "T7 run"',
    ]);
    expect(
      store
        .list("MSI")
        .map((topic) => topic.name)
        .sort(),
    ).toEqual(["256K twin", "T7 run"]);

    store.move("q-1", { name: "Seeded QA" }, "MSI", false);
    const [move] = store.changes("MSI");
    expect(move.text).toBe('Moved q-1 from "T7 run" to "Seeded QA"');
    store.undo(move.id);
    expect(store.topicOfQuest("q-1")?.name).toBe("T7 run");
    // The topic the move created is gone again.
    expect(store.findByName("MSI", "Seeded QA")).toBeUndefined();
  });

  it("offers changes to undo for a day, until undone or dismissed", async () => {
    // The panel lists recent changes with Undo; they must not stay there for good: undone,
    // dismissed and day-old changes leave the list (dismissing keeps the change itself).
    const store = await newStore();
    const t7 = store.assign({ questId: "q-1", space: "MSI", name: "T7 run", by: "agent", byAgent: false }).topic;
    const twin = store.assign({ questId: "q-2", space: "MSI", name: "256K twin", by: "agent", byAgent: false }).topic;
    const qa = store.assign({ questId: "q-3", space: "MSI", name: "Seeded QA", by: "agent", byAgent: false }).topic;
    store.merge(twin.id, t7.id, true, "Folded");
    now += 1000;
    store.merge(qa.id, t7.id, true, "Folded");
    const [newer, older] = store.changes("MSI");
    expect(newer.text).toBe('Folded "Seeded QA" into "T7 run"');

    store.dismissChanges([newer.id]);
    expect(store.changes("MSI").map((change) => change.id)).toEqual([older.id]);
    expect(store.topicOfQuest("q-3")?.name).toBe("T7 run");
    store.undo(older.id);
    expect(store.changes("MSI")).toEqual([]);

    store.move("q-1", { name: "Evals" }, "MSI", false);
    expect(store.changes("MSI")).toHaveLength(1);
    now += CHANGE_SHOWN_MS + 1;
    expect(store.changes("MSI")).toEqual([]);
  });

  it("orders topics by their newest real activity and sums up each one's news", async () => {
    // Main's topic list shows what moved: a page rewrite (every Scribe rewrites after a restart) is
    // not activity, while a finished quest or the user's message is. Each topic also carries its
    // newest History line and what in its Now waits on the user.
    const store = await newStore();
    now = NOW;
    const t7 = store.assign({ questId: "q-1", space: "MSI", name: "T7 run", by: "agent", byAgent: false }).topic;
    now = NOW + 1000;
    const qa = store.assign({ questId: "q-2", space: "MSI", name: "Seeded QA", by: "agent", byAgent: false }).topic;
    now = NOW + 2000;
    store.addEvent(t7.id, { at: now, kind: "quest_done", questId: "q-1", text: "Launch T7" });
    now = NOW + 3000;
    store.writePage(
      qa.id,
      "QA data.\n\n## History\n- **Oct 24** · Mix tuned ([q-2](quest:q-2)).\n- **Oct 23** · Older.",
      now,
    );
    store.addNow(t7.id, { group: "followup", text: "pick the **SBV** grading ([q-1](quest:q-1))." });
    store.addNow(t7.id, { group: "next", text: "the verdict." });

    const [first, second] = store.list("MSI");
    expect(first).toMatchObject({
      name: "T7 run",
      activityAt: NOW + 2000,
      latestActivity: { text: "q-1 finished", questId: "q-1" },
      openNow: 2,
    });
    expect(second).toMatchObject({
      name: "Seeded QA",
      activityAt: NOW + 1000,
      latestUpdate: "Oct 24 · Mix tuned (q-2).",
    });
  });

  // Threads (New thread) are lightweight conversations, not topics: never listed or matched as
  // topics. One joins a topic when the leader files it there, or follows the first quest started
  // from it into that quest's topic; it never makes a topic by itself. Reading its last answer
  // settles it; writing in it makes it active again.
  it("keeps threads apart from topics, files them under existing topics and lets quests pull them along", async () => {
    const store = await newStore();
    const thread = store.startThread({ space: "MSI", name: "Why wasn't the old draft…", leaderId: "lead" });
    expect(thread).toMatchObject({ name: "Why wasn't the old draft…", leaderId: "lead", activityAt: NOW });
    expect(thread.key).toBe(`topic:${thread.id.replace(/-/g, "").slice(0, 8)}`);
    expect(store.list("MSI")).toEqual([]);
    // A quest filed under the thread's name makes a topic of its own, never the thread.
    const named = store.assign({
      questId: "q-1",
      space: "MSI",
      name: "Why wasn't the old draft…",
      by: "agent",
      byAgent: false,
    });
    expect(named.created).toBe(true);
    expect(() => store.fileThread(thread.id, "No such topic", false)).toThrow(/new topics grow from quests/);

    const t7 = store.assign({ questId: "q-2", space: "MSI", name: "T7 run", by: "agent", byAgent: false }).topic;
    expect(store.fileThread(thread.key, "T7 run", false).topic).toEqual({ id: t7.id, name: "T7 run" });
    expect(store.list("MSI").find((topic) => topic.id === t7.id)?.threads).toEqual([
      { handle: thread.id.replace(/-/g, "").slice(0, 8), name: "Why wasn't the old draft…" },
    ]);

    const second = store.startThread({ space: "MSI", name: "Seeded QA mix", leaderId: "lead" });
    expect(store.threadFollowsQuest(second.key, named.topic.id)?.topic?.id).toBe(named.topic.id);
    // Once filed, a later quest's topic doesn't move it.
    expect(store.threadFollowsQuest(second.key, t7.id)).toBeNull();

    // Reading its last answer settles a thread; one under no topic is then the Scribe's to file.
    const third = store.startThread({ space: "MSI", name: "Quick question", leaderId: "lead" });
    expect(store.settleThread(third.key)?.id).toBe(third.id);
    expect(store.settleThread(third.key)).toBeNull();
    expect(store.settledUnfiledThreads("lead").map((thread) => thread.id)).toEqual([third.id]);
    store.markThreadsSortAsked([third.id]);
    expect(store.settledUnfiledThreads("lead")).toEqual([]);
    expect(store.settleThread(second.key)).toBeNull();
    // Writing in it again makes it active again, and brings it to the top of the list.
    store.addEvent(third.id, { at: NOW + 5000, kind: "message", text: "one more thing" });
    expect(store.threadsOf("lead")[0]).toMatchObject({ id: third.id, activityAt: NOW + 5000 });
    expect(store.threadsOf("lead")[0]?.settledAt).toBeUndefined();
  });

  it("counts events after the page and summarizes the page by its opening sentence", async () => {
    const store = await newStore();
    const { topic } = store.assign({ questId: "q-1", space: "MSI", name: "T7 run", by: "agent", byAgent: false });
    expect(store.summary(store.resolve(topic.id)!).pendingEvents).toBe(1);
    store.writePage(topic.id, "## Where it stands\nStep ~165; the [twin](session:1:2) tracks T7.\n\n## Made\n- x", now);
    expect(store.list("MSI")[0]).toMatchObject({ pendingEvents: 0, summary: "Step ~165; the twin tracks T7." });
    expect(pageSummary("No headings here.\n\nSecond paragraph")).toBe("No headings here.");
    // A page opens with its one-sentence summary, which the topic list shows.
    expect(pageSummary("Library of topics and artifacts.\n## Now\n- Nothing open.")).toBe(
      "Library of topics and artifacts.",
    );

    await store.flush();
    const reloaded = await newStore();
    expect(reloaded.list("MSI")[0]).toMatchObject({ name: "T7 run", pendingEvents: 0 });
  });
});

function userMessage(text: string, threadKey: string, at: number): BrowserIncomingMessage {
  return {
    type: "user_message",
    content: text,
    timestamp: at,
    threadRefs: [{ threadKey, questId: threadKey, source: "explicit", attachedAt: at }],
  } as unknown as BrowserIncomingMessage;
}

/** A turn as history holds it: the user's timed message, then the untimed result with the turn's usage. */
type Quest = { questId: string; title: string; createdAt: number; leaderSessionId: string; status: string };

const LEADERS = {
  leader: {
    sessionId: "leader",
    sessionNum: 7,
    name: "Daily Leader",
    space: "MSI",
    isOrchestrator: true,
    archived: false,
  },
  other: {
    sessionId: "other",
    sessionNum: 9,
    name: "Data Leader",
    space: "MSI",
    isOrchestrator: true,
    archived: false,
  },
};

async function setupService() {
  vi.useFakeTimers({ now: NOW, toFake: ["setTimeout", "clearTimeout", "Date"] });
  const store = await newStore();
  const leader: TopicSessionLike = { id: "leader", messageHistory: [], state: { treeGroupId: "msi-group" } };
  const sessions = new Map<string, TopicSessionLike>([
    ["leader", leader],
    ["other", { id: "other", messageHistory: [], state: {} }],
  ]);
  // 25 older quests make the leader worth a hint; recent ones are what a Scribe sorts.
  const quests: Quest[] = Array.from({ length: 25 }, (_, index) => ({
    questId: `q-${index}`,
    title: `Old quest ${index}`,
    createdAt: NOW - 40 * DAY,
    leaderSessionId: "leader",
    status: "done",
  }));
  const injected: Array<{ sessionId: string; text: string }> = [];
  const notices: Array<{ leaderId: string; text: string }> = [];
  const created: string[] = [];
  const busy = new Set<string>();
  const retired: string[] = [];
  const messages = new Map<string, string>();
  // The remote host each session and leader runs on; absent means the coordinator's machine.
  const hosts = new Map<string, string>();
  const leaderHosts = new Map<string, string>();
  const unstartable = new Set<string>();
  const leaderInfo = (id: string) => {
    const leader = LEADERS[id as keyof typeof LEADERS];
    const hostId = leaderHosts.get(id);
    return leader && hostId ? { ...leader, hostId } : leader;
  };
  const service = new TopicService(store, {
    getSession: (id) => sessions.get(id),
    getLeaderInfo: leaderInfo,
    listLeaders: () => Object.keys(LEADERS).map((id) => leaderInfo(id)!),
    sessionNum: (id) => (id.startsWith("scribe") ? 100 + Number(id.split("-")[2]) : 7),
    leaderOf: (id) => (id in LEADERS ? id : undefined),
    listQuests: async () => quests as unknown as QuestmasterTask[],
    inject: (sessionId, text) => {
      injected.push({ sessionId, text });
      return true;
    },
    createScribe: async (info) => {
      if (info.hostId && unstartable.has(info.hostId)) throw new Error(`Host ${info.hostId} is offline`);
      const id = `scribe-${info.sessionId}-${created.length + 1}`;
      created.push(id);
      sessions.set(id, { id, messageHistory: [], state: {} });
      if (info.hostId) hosts.set(id, info.hostId);
      return id;
    },
    isScribeAlive: (id) => sessions.has(id),
    hostOf: (id) => hosts.get(id),
    isScribeBusy: (id) => busy.has(id),
    retireScribe: async (id) => {
      retired.push(id);
      sessions.delete(id);
    },
    notifyLeader: (leaderId, text) => notices.push({ leaderId, text }),
    messageText: (sessionNum, index) => messages.get(`${sessionNum}:${index}`) ?? null,
    broadcastChanged: () => {},
    now: () => Date.now(),
  });
  return {
    ...{ store, service, leader, sessions, quests, injected, notices, created, busy, retired, messages },
    ...{ leaderHosts, unstartable },
  };
}

/** Turns topics on for a leader and ends its initialization turn, so later tests start from quiet. */
async function enable(service: TopicService, store: TopicStore, leaderId: string) {
  await service.setLeaderEnabled(leaderId, true);
  const scribe = store.scribeSession(leaderId)!;
  await service.scribeTurnEnded(scribe);
  return scribe;
}

/** A page with everything of the leader up to now, as a Scribe's write after reading `changes`. */
function writePage(store: TopicStore, name: string, leaderId = "leader") {
  store.writePage(store.findByName("MSI", name)!.id, "## Where it stands\nUp to date.", Date.now(), { leaderId });
}

describe("topic service", () => {
  it("suggests topics at about 20 quests; turning them on starts a Scribe and asks it to initialize", async () => {
    const { service, injected, store, created, retired } = await setupService();
    expect((await service.leaderStates())[0]).toMatchObject({ enabled: false, questCount: 25, suggest: true });

    store.setScribeInstructions("leader", "One topic per training run.");
    await service.setLeaderEnabled("leader", true);
    expect(created).toEqual(["scribe-leader-1"]);
    expect(injected.map((message) => message.sessionId)).toEqual(["scribe-leader-1"]);
    expect(injected[0].text).toContain("Start initialization for your leader #7");
    expect(injected[0].text).toContain("sort its recent work into topics");
    expect(injected[0].text).toContain('instructions: "One topic per training run."');

    // Off archives the Scribe; on again starts a new one, which initializes and is told the instructions.
    await service.setLeaderEnabled("leader", false);
    expect(retired).toEqual(["scribe-leader-1"]);
    expect(store.scribeSession("leader")).toBeUndefined();
    await service.setLeaderEnabled("leader", true);
    expect(created).toEqual(["scribe-leader-1", "scribe-leader-2"]);
    expect(injected.at(-1)).toMatchObject({
      sessionId: "scribe-leader-2",
      text: expect.stringContaining("One topic per training run."),
    });
  });

  it("sends what changed as soon as the Scribe is idle, and holds later changes until its turn ends", async () => {
    const { service, injected, store, leader, busy } = await setupService();
    const scribe = await enable(service, store, "leader");
    store.assign({ questId: "q-2713", space: "MSI", name: "T7 run", by: "agent", byAgent: false, leaderId: "leader" });
    service.changed("leader");
    await vi.advanceTimersByTimeAsync(0);
    expect(injected.at(-1)?.text).toContain("q-2713 was put under this topic");
    vi.advanceTimersByTime(10);
    writePage(store, "T7 run");
    await service.scribeTurnEnded(scribe);
    injected.length = 0;
    vi.advanceTimersByTime(1000);

    // The user's messages in the quest's tab go out after a short pause (a burst becomes one
    // message), with links to the messages.
    leader.messageHistory.push(userMessage("Keep 0.02, launch now", "q-2713", Date.now()));
    leader.messageHistory.push(userMessage("unrelated", "main", Date.now()));
    service.sessionSaved("leader");
    await vi.advanceTimersByTimeAsync(0);
    expect(injected).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(injected).toHaveLength(1);
    expect(injected[0]).toMatchObject({ sessionId: scribe });
    expect(injected[0].text).toContain('the user wrote in q-2713 ([message](session:7:0)): "Keep 0.02, launch now"');
    expect(injected[0].text).not.toContain("unrelated");

    // While it works, the next message waits, and goes out when its turn ends.
    busy.add(scribe);
    leader.messageHistory.push(userMessage("Also redo the plots by data", "q-2713", Date.now()));
    service.sessionSaved("leader");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(injected).toHaveLength(1);
    vi.advanceTimersByTime(10);
    writePage(store, "T7 run");
    busy.delete(scribe);
    await service.scribeTurnEnded(scribe);
    expect(injected).toHaveLength(2);
    expect(injected[1].text).toContain("Also redo the plots by data");
    expect(injected[1].text).not.toContain("Keep 0.02");
  });

  it("does not echo a Scribe's own sorting and tidying back to it", async () => {
    const { service, injected, store } = await setupService();
    await enable(service, store, "leader");
    injected.length = 0;
    // A Scribe's filing (byAgent) needs a page update but is no news to the Scribe.
    store.assign({ questId: "q-1", space: "MSI", name: "T7 run", by: "agent", byAgent: true, leaderId: "leader" });
    service.changed("leader");
    await vi.advanceTimersByTimeAsync(0);
    expect(injected).toHaveLength(0);
    expect(store.pendingEvents(store.findByName("MSI", "T7 run")!.id, "leader")).toHaveLength(1);
  });

  it("shares a topic between leaders: each Scribe hears and covers its own leader's events", async () => {
    const { service, injected, store } = await setupService();
    const a = await enable(service, store, "leader");
    const b = await enable(service, store, "other");
    injected.length = 0;
    const { topic } = store.assign({
      questId: "q-1",
      space: "MSI",
      name: "T7 run",
      by: "agent",
      byAgent: false,
      leaderId: "leader",
    });
    store.assign({ questId: "q-2", space: "MSI", name: "T7 run", by: "agent", byAgent: false, leaderId: "other" });
    expect(await service.deliver("leader")).toBe("sent");
    expect(await service.deliver("other")).toBe("sent");
    expect(injected.map((message) => message.sessionId)).toEqual([a, b]);
    expect(injected[0].text).toContain("q-1 was put under");
    expect(injected[0].text).not.toContain("q-2");

    // A's page covers A's events only; B's Scribe still has its own to add.
    const revision = store.pageRevision(topic.id);
    store.writePage(topic.id, "## Where it stands\nA's part.", Date.now(), { leaderId: "leader", revision });
    expect(store.pendingEvents(topic.id, "leader")).toEqual([]);
    expect(store.pendingEvents(topic.id, "other").map((event) => event.questId)).toEqual(["q-2"]);
    // A write based on the page before A's is refused, so B merges instead of overwriting.
    expect(() =>
      store.writePage(topic.id, "## Where it stands\nB only.", Date.now(), { leaderId: "other", revision }),
    ).toThrow(/changed since you read it/);
  });

  it("names new quests with no topic and changed instructions, each once", async () => {
    const { service, injected, store, quests } = await setupService();
    const scribe = await enable(service, store, "leader");
    injected.length = 0;
    vi.advanceTimersByTime(1000);
    quests.push({
      questId: "q-90",
      title: "Check the twin",
      createdAt: Date.now(),
      leaderSessionId: "leader",
      status: "refined",
    });
    store.setScribeInstructions("leader", "One topic per training run.");
    service.changed("leader");
    await vi.advanceTimersByTimeAsync(0);
    expect(injected).toHaveLength(1);
    expect(injected[0].text).toContain('instructions changed: "One topic per training run."');
    expect(injected[0].text).toContain("- q-90 Check the twin");

    // Nothing new after its turn: no message.
    vi.advanceTimersByTime(10);
    await service.scribeTurnEnded(scribe);
    expect(injected).toHaveLength(1);
  });

  it("reminds a Scribe once when it stops with work left, then tells its leader", async () => {
    const { service, injected, notices, store } = await setupService();
    const scribe = await enable(service, store, "leader");
    const { topic } = store.assign({
      questId: "q-1",
      space: "MSI",
      name: "T7 run",
      by: "agent",
      byAgent: false,
      leaderId: "leader",
    });
    service.changed("leader");
    await vi.advanceTimersByTimeAsync(0);
    injected.length = 0;

    await service.scribeTurnEnded(scribe);
    expect(injected).toHaveLength(1);
    expect(injected[0].text).toContain('"T7 run": 1 event not on its page yet');
    expect(injected[0].text).toContain("--unchanged");

    await service.scribeTurnEnded(scribe);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      leaderId: "leader",
      text: expect.stringContaining("Your Scribe #101 stopped twice"),
    });

    // Marking the events read counts as done: the next message and turn end need no reminder.
    vi.advanceTimersByTime(10);
    service.event(topic.id, "leader", { at: Date.now(), kind: "message", text: "Launch it" });
    await vi.advanceTimersByTimeAsync(0);
    vi.advanceTimersByTime(10);
    store.markCovered(topic.id, Date.now(), "leader");
    injected.length = 0;
    await service.scribeTurnEnded(scribe);
    expect(injected).toHaveLength(0);
  });

  it("reminds a Scribe whose initialization sorted nothing", async () => {
    const { service, injected, store, quests } = await setupService();
    quests.push({ questId: "q-91", title: "A", createdAt: NOW, leaderSessionId: "leader", status: "done" });
    await service.setLeaderEnabled("leader", true);
    await service.scribeTurnEnded(store.scribeSession("leader")!);
    expect(injected.at(-1)?.text).toContain("none of 1 recent quests is under a topic yet");
  });

  it("hears about checks ticked and notes the user or leader adds to a quest, not workers' write-ups", async () => {
    // Something the user resolves elsewhere reaches the topic as a ticked check or a leader's note
    // on the quest; the first look at a quest only records where it stands.
    const { service, injected, store } = await setupService();
    const scribe = await enable(service, store, "leader");
    const topic = store.assign({
      questId: "q-1",
      space: "MSI",
      name: "T7 run",
      by: "agent",
      byAgent: true,
      leaderId: "leader",
    });
    await service.scribeTurnEnded(scribe);
    const quest = (checked: boolean, feedback: object[]) =>
      ({
        questId: "q-1",
        title: "Launch T7",
        status: "in_progress",
        leaderSessionId: "leader",
        verificationItems: [{ text: "Try it on the phone", checked }],
        feedback,
      }) as unknown as QuestmasterTask;
    const userNote = { author: "human", text: "Jiayi: the dashboard works now", ts: NOW, authorSessionId: "leader" };
    service.questChanged(quest(false, [userNote]));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.detail(topic.topic.id).events.filter((event) => event.kind === "note")).toHaveLength(0);

    injected.length = 0;
    service.questChanged(
      quest(true, [
        userNote,
        { author: "agent", text: "Work done", ts: NOW, authorSessionId: "worker", kind: "phase_summary" },
        { author: "agent", text: "Worker comment", ts: NOW, authorSessionId: "worker" },
        { author: "agent", text: "The user says the old export no longer matters", ts: NOW, authorSessionId: "leader" },
      ]),
    );
    await vi.advanceTimersByTimeAsync(0);
    const events = store.detail(topic.topic.id).events;
    expect(events.filter((event) => event.kind === "check").map((event) => event.text)).toEqual([
      "Try it on the phone",
    ]);
    expect(events.filter((event) => event.kind === "note").map((event) => event.text)).toEqual([
      "The user says the old export no longer matters",
    ]);
    expect(injected[0]!.text).toContain('in q-1, a check for the user was ticked: "Try it on the phone"');
  });

  it("keeps Now as entries a Scribe adds, edits and removes, and passes a done mark to the Scribe", async () => {
    const { service, injected, store } = await setupService();
    const scribe = await enable(service, store, "leader");
    const { topic } = store.assign({
      questId: "q-1",
      space: "MSI",
      name: "T7 run",
      by: "agent",
      byAgent: true,
      leaderId: "leader",
    });
    await service.scribeTurnEnded(scribe);
    now = NOW;
    store.writePage(topic.id, "T7.\n\n## History\n- Oct 23", NOW, { leaderId: "leader" });
    const twin = store.addNow(topic.id, {
      group: "next",
      text: "compare with the twin ([q-1](quest:q-1)).",
      leaderId: "leader",
    });
    expect(twin).toMatchObject({ group: "next", leaderId: "leader", questIds: ["q-1"], since: NOW });
    expect(() => store.addNow(topic.id, { group: "waiting", text: "images" })).toThrow(/whom it waits on/);

    // Editing keeps the date; an event of a linked quest is news about it.
    now = NOW + 3 * DAY;
    store.editNow(topic.id, twin.id, { text: "compare with the 256K twin ([q-1](quest:q-1)).", due: "2026-11-06" });
    expect(store.nowEntries(topic.id)[0]).toMatchObject({ since: NOW, lastNews: NOW + 3 * DAY, due: "2026-11-06" });
    now = NOW + 4 * DAY;
    store.addEvent(topic.id, { at: now, kind: "artifact", questId: "q-1", text: "report" });
    expect(store.nowEntries(topic.id)[0]!.lastNews).toBe(NOW + 4 * DAY);

    // A done tap needs no Scribe round: the event waits to ride along with the next message, the
    // entry stays struck through for a day (Undo), and then it is gone.
    const budgets = store.addNow(topic.id, { group: "next", text: "ask about budgets.", leaderId: "leader" });
    injected.length = 0;
    service.nowDone(topic.id, "leader", budgets.id);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(injected).toHaveLength(0);
    expect(store.nowEntries(topic.id).find((entry) => entry.id === budgets.id)!.doneAt).toBe(now);
    expect(store.list("MSI").find((t) => t.id === topic.id)!.pendingEvents).toBe(1); // the artifact, not the tap
    service.nowDone(topic.id, "leader", budgets.id, false);
    expect(store.nowEntries(topic.id).find((entry) => entry.id === budgets.id)!.doneAt).toBeUndefined();
    service.nowDone(topic.id, "leader", budgets.id);
    service.artifactSaved({ sessionId: "leader", threadKey: "q-1", title: "Plots", kind: "figure", version: 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(injected).toHaveLength(1);
    expect(injected[0]!.text).toContain(`the user marked Now entry ${budgets.id} done on the page`);
    expect(injected[0]!.text).toContain('figure "Plots" was saved in q-1');
    now = NOW + 6 * DAY;
    expect(store.nowEntries(topic.id).map((entry) => entry.id)).toEqual([twin.id]);

    expect(store.removeNow(topic.id, twin.id)).toContain("256K twin");
    expect(store.nowEntries(topic.id)).toEqual([]);
  });

  it("moves the Now section of pages written before entries into entries, once, at load", async () => {
    // Pages saved before Now was kept as entries carry it as text; at load it becomes entries
    // credited to the one leader whose Scribe wrote the page, and leaves the page.
    const root = await mkdtemp(join(tmpdir(), "topics-now-"));
    const first = new TopicStore(root, () => NOW);
    await first.load();
    const { topic } = first.assign({ questId: "q-1", space: "MSI", name: "T7 run", by: "agent", byAgent: true });
    first.writePage(
      topic.id,
      "T7.\n\n## Now\n- **Waiting on Parsewave:** images ([q-1](quest:q-1)).\n- **Not tried on your iPhone:** the panel.\n- **Asked:** track formal methods.\n\n## History\n- Oct 23",
      NOW,
      { leaderId: "leader" },
    );
    await first.flush();
    const raw = JSON.parse(await readFile(join(root, "topics.json"), "utf-8"));
    delete raw.topics[topic.id].now;
    await writeFile(join(root, "topics.json"), JSON.stringify(raw));

    const second = new TopicStore(root, () => NOW + DAY);
    await second.load();
    expect(second.detail(topic.id).page).toBe("T7.\n\n## History\n- Oct 23");
    expect(
      second.nowEntries(topic.id).map(({ group, who, text, leaderId }) => ({ group, who, text, leaderId })),
    ).toEqual([
      { group: "waiting", who: "Parsewave", text: "images ([q-1](quest:q-1)).", leaderId: "leader" },
      { group: "try", who: undefined, text: "the panel.", leaderId: "leader" },
      { group: "next", who: undefined, text: "Asked: track formal methods.", leaderId: "leader" },
    ]);
    await rm(root, { recursive: true, force: true });
  });

  it("turns stored Waiting on you entries into Follow-ups at load, and saves that", async () => {
    // Open questions to the user now come from notifications; what Scribes kept under the retired
    // "you" group are optional follow-ups. Each entry keeps its ID, text and dates.
    const root = await mkdtemp(join(tmpdir(), "topics-followups-"));
    const first = new TopicStore(root, () => NOW);
    await first.load();
    const { topic } = first.assign({ questId: "q-1", space: "MSI", name: "T7 run", by: "agent", byAgent: true });
    const entry = first.addNow(topic.id, { group: "next", text: "set up the hosts." });
    first.addNow(topic.id, { group: "next", text: "the verdict." });
    await first.flush();
    const raw = JSON.parse(await readFile(join(root, "topics.json"), "utf-8"));
    raw.topics[topic.id].now[0].group = "you";
    await writeFile(join(root, "topics.json"), JSON.stringify(raw));

    const second = new TopicStore(root, () => NOW);
    await second.load();
    expect(second.nowEntries(topic.id).map(({ id, group }) => ({ id, group }))).toEqual([
      { id: entry.id, group: "followup" },
      { id: expect.any(String), group: "next" },
    ]);
    await second.flush();
    const saved = JSON.parse(await readFile(join(root, "topics.json"), "utf-8"));
    expect(saved.topics[topic.id].now[0].group).toBe("followup");
    await rm(root, { recursive: true, force: true });
  });

  it("starts a Scribe on its leader's machine and moves one started elsewhere at its next message", async () => {
    // A leader on a remote host gets its Scribe there. A Scribe started on another machine (before
    // Scribes followed their leader) is replaced at its next message; the old one is archived only
    // after the new one starts, so a machine that can't start one leaves the old Scribe working.
    const { service, injected, store, created, retired, leaderHosts, unstartable } = await setupService();
    const scribe = await enable(service, store, "leader");
    expect(scribe).toBe("scribe-leader-1");
    store.assign({ questId: "q-1", space: "MSI", name: "T7 run", by: "agent", byAgent: true, leaderId: "leader" });
    await service.scribeTurnEnded(scribe);
    const artifact = (title: string) =>
      service.artifactSaved({ sessionId: "leader", threadKey: "q-1", title, kind: "figure", version: 1 });

    // The leader's laptop can't start one now: the old Scribe keeps working.
    leaderHosts.set("leader", "laptop");
    unstartable.add("laptop");
    artifact("First");
    await vi.advanceTimersByTimeAsync(0);
    expect(created).toEqual(["scribe-leader-1"]);
    expect(retired).toEqual([]);
    expect(injected.at(-1)).toMatchObject({ sessionId: "scribe-leader-1", text: expect.stringContaining("First") });
    writePage(store, "T7 run");
    await service.scribeTurnEnded(scribe);

    // Once it can, the next message goes to a new Scribe on the laptop and the old one is archived.
    unstartable.delete("laptop");
    artifact("Second");
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    // Lets the delivery the timer started finish (it saves the store on the way).
    await service.deliver("leader");
    expect(created).toEqual(["scribe-leader-1", "scribe-leader-2"]);
    expect(retired).toEqual(["scribe-leader-1"]);
    expect(store.scribeSession("leader")).toBe("scribe-leader-2");
    expect(injected.at(-1)).toMatchObject({ sessionId: "scribe-leader-2", text: expect.stringContaining("Second") });

    // On the leader's machine it stays.
    writePage(store, "T7 run");
    await service.scribeTurnEnded("scribe-leader-2");
    artifact("Third");
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(created).toHaveLength(2);
    expect(injected.at(-1)).toMatchObject({ sessionId: "scribe-leader-2", text: expect.stringContaining("Third") });
  });

  it("sends the leader's first event at once, debounces a burst, and debounces the user's own", async () => {
    // A Scribe round per event wastes work: a burst becomes one message after a 30-second pause,
    // the leader's first event after a quiet spell goes at once, and nothing waits over 2 minutes.
    const { service, injected, store } = await setupService();
    const scribe = await enable(service, store, "leader");
    const { topic } = store.assign({
      questId: "q-1",
      space: "MSI",
      name: "T7 run",
      by: "agent",
      byAgent: true,
      leaderId: "leader",
    });
    await service.scribeTurnEnded(scribe);
    injected.length = 0;
    const artifact = (title: string) =>
      service.artifactSaved({ sessionId: "leader", threadKey: "q-1", title, kind: "figure", version: 1 });

    artifact("First");
    await vi.advanceTimersByTimeAsync(0);
    expect(injected).toHaveLength(1);
    writePage(store, "T7 run");
    await service.scribeTurnEnded(scribe);

    // A burst right after: one message once the burst pauses.
    artifact("Second");
    await vi.advanceTimersByTimeAsync(20_000);
    artifact("Third");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(injected).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(injected).toHaveLength(2);
    expect(injected[1]!.text).toContain('figure "Second"');
    expect(injected[1]!.text).toContain('figure "Third"');
    expect(store.detail(topic.id).events.at(-1)?.kind).toBe("artifact");
  });

  it("tells the Scribe every time a reopened quest finishes again, with its wrap-up", async () => {
    // Each landing completes a reopened quest; only the first completion used to reach the Scribe,
    // so pages kept saying work was waiting to land after it was live.
    const { service, injected, store } = await setupService();
    await enable(service, store, "leader");
    store.assign({ questId: "q-1", space: "MSI", name: "T7 run", by: "agent", byAgent: true, leaderId: "leader" });
    const finish = (completedAt: number, wrapUp: string) =>
      service.questChanged({
        questId: "q-1",
        title: "Launch T7",
        status: "done",
        leaderSessionId: "leader",
        completedAt,
        debriefTldr: wrapUp,
      } as unknown as QuestmasterTask);
    injected.length = 0;
    finish(Date.now(), "Submitted to the landing queue.");
    await vi.advanceTimersByTimeAsync(0);
    finish(Date.now() - 1, "Submitted to the landing queue.");
    vi.advanceTimersByTime(5 * 60_000);
    finish(Date.now(), "Landed; live after the restart.");
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    const done = store.detail(store.findByName("MSI", "T7 run")!.id).events.filter((e) => e.kind === "quest_done");
    expect(done.map((event) => event.text)).toEqual([
      "Launch T7 · Submitted to the landing queue.",
      "Launch T7 · Landed; live after the restart.",
    ]);
  });

  it("saves the user's requests for one page and tells the Scribe, unless it saved them itself", async () => {
    // A request such as "keep links to the two newest reports" belongs to one page; it is kept with
    // the topic and reaches the Scribe as news, but a Scribe saving it for the user hears nothing back.
    const { service, injected, store } = await setupService();
    await enable(service, store, "leader");
    const { topic } = store.assign({
      questId: "q-1",
      space: "MSI",
      name: "Daily briefing",
      by: "agent",
      byAgent: true,
      leaderId: "leader",
    });
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    injected.length = 0;

    service.setPageRequests(topic.id, "leader", "  Keep links to the two newest reports at the top. ");
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(store.detail(topic.id).instructions).toBe("Keep links to the two newest reports at the top.");
    expect(injected.at(-1)?.text).toContain(
      `the user's requests for this page are now: "Keep links to the two newest reports at the top."`,
    );

    injected.length = 0;
    service.setPageRequests(topic.id, "leader", "Also a status table.", true);
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(store.detail(topic.id).instructions).toBe("Also a status table.");
    expect(injected).toEqual([]);
  });

  it("tells the Scribe which checks a finished quest left for the user", async () => {
    // Unticked checks are often what Now needs ("try it on the phone", "send the guide").
    const { service, injected, store } = await setupService();
    await enable(service, store, "leader");
    store.assign({ questId: "q-1", space: "MSI", name: "T7 run", by: "agent", byAgent: true, leaderId: "leader" });
    injected.length = 0;
    service.questChanged({
      questId: "q-1",
      title: "Launch T7",
      status: "done",
      leaderSessionId: "leader",
      verificationItems: [
        { text: "Check the dashboard on the phone", checked: false },
        { text: "Restart the server", checked: true },
      ],
    } as unknown as QuestmasterTask);
    await vi.advanceTimersByTimeAsync(0);
    expect(injected[0]!.text).toContain(
      "q-1 finished: Launch T7 · left for the user: Check the dashboard on the phone",
    );
    expect(injected[0]!.text).not.toContain("Restart the server");
  });

  it("asks a Scribe once to rewrite pages written in an older format", async () => {
    // Pages from before the current page format stay as written until the Scribe is asked; it is
    // asked once (at startup), and a Scribe that initializes writes the current format already.
    const { service, injected, store } = await setupService();
    const scribe = await enable(service, store, "leader");
    store.assign({ questId: "q-1", space: "MSI", name: "T7 run", by: "agent", byAgent: true, leaderId: "leader" });
    store.setPageFormat("leader", PAGE_FORMAT - 1);
    injected.length = 0;

    service.askOutdatedScribes();
    await vi.advanceTimersByTimeAsync(0);
    expect(injected).toHaveLength(1);
    expect(injected[0]!.text).toContain("Rewrite each page of your leader's topics");
    expect(injected[0]!.text).toContain("bring its Now entries in line with what its quests left open");

    // A turn that rewrote nothing gets a reminder naming the pages left; the request stands.
    vi.advanceTimersByTime(10);
    await service.scribeTurnEnded(scribe);
    expect(injected).toHaveLength(2);
    expect(injected[1]!.text).toContain('1 page isn\'t rewritten yet: "T7 run"');
    expect(store.pageFormat("leader")).toBe(PAGE_FORMAT - 1);

    // Once every page is rewritten, the format is recorded and nobody is asked again. A page the
    // Scribe confirmed as already current (`write-page --unchanged`) counts as rewritten.
    vi.advanceTimersByTime(10);
    now = Date.now(); // the store's clock, which stamps when the page was checked
    store.markCovered(store.findByName("MSI", "T7 run")!.id, Date.now(), "leader");
    await service.scribeTurnEnded(scribe);
    expect(store.pageFormat("leader")).toBe(PAGE_FORMAT);
    service.askOutdatedScribes();
    await vi.advanceTimersByTimeAsync(0);
    expect(injected).toHaveLength(2);
  });

  it("counts pages rewritten before a reminder as rewritten", async () => {
    // After the Oct 26 restart a Scribe rewrote 3 pages, was reminded of the other 29, rewrote those,
    // and its leader was still told it stopped twice: the reminder restarted the clock, so the 3
    // pages from before it looked unwritten. Work counts from the request itself.
    const { service, injected, notices, store } = await setupService();
    const scribe = await enable(service, store, "leader");
    store.assign({ questId: "q-1", space: "MSI", name: "T7 run", by: "agent", byAgent: true, leaderId: "leader" });
    store.assign({ questId: "q-2", space: "MSI", name: "Twin", by: "agent", byAgent: true, leaderId: "leader" });
    store.setPageFormat("leader", PAGE_FORMAT - 1);
    service.askOutdatedScribes();
    await vi.advanceTimersByTimeAsync(0);
    injected.length = 0;
    const rewrite = (name: string) => {
      vi.advanceTimersByTime(10);
      now = Date.now(); // the store's clock, which stamps when the page was checked
      store.markCovered(store.findByName("MSI", name)!.id, Date.now(), "leader");
      vi.advanceTimersByTime(10); // the turn ends a little after the page was saved
    };

    rewrite("T7 run");
    await service.scribeTurnEnded(scribe);
    expect(injected).toHaveLength(1);
    expect(injected[0]!.text).toContain('1 page isn\'t rewritten yet: "Twin"');

    rewrite("Twin");
    await service.scribeTurnEnded(scribe);
    expect(notices).toHaveLength(0);
    expect(store.pageFormat("leader")).toBe(PAGE_FORMAT);
  });

  it("clears a Scribe's stopped state once a later turn leaves nothing of the request", async () => {
    // A Scribe that stopped twice may finish later, on its own or asked by its leader, in a turn
    // that answers no message of Takode's. Its status said "Stopped before finishing" until the
    // next message went; now the next finished turn checks again.
    const { service, injected, notices, store } = await setupService();
    const scribe = await enable(service, store, "leader");
    store.assign({ questId: "q-1", space: "MSI", name: "T7 run", by: "agent", byAgent: true, leaderId: "leader" });
    store.setPageFormat("leader", PAGE_FORMAT - 1);
    service.askOutdatedScribes();
    await vi.advanceTimersByTimeAsync(0);
    await service.scribeTurnEnded(scribe);
    await service.scribeTurnEnded(scribe);
    expect(notices).toHaveLength(1);
    expect((await service.activity("leader")).text).toBe("Stopped before finishing; your leader was told");

    // A turn that still leaves the page keeps the state.
    await service.scribeTurnEnded(scribe);
    expect((await service.activity("leader")).text).toBe("Stopped before finishing; your leader was told");

    vi.advanceTimersByTime(10);
    now = Date.now();
    store.markCovered(store.findByName("MSI", "T7 run")!.id, Date.now(), "leader");
    const sent = injected.length;
    await service.scribeTurnEnded(scribe);
    expect((await service.activity("leader")).text).toBe("Up to date");
    expect(store.pageFormat("leader")).toBe(PAGE_FORMAT);
    // Nothing more is sent or told for it.
    await vi.advanceTimersByTimeAsync(0);
    expect(injected).toHaveLength(sent);
    expect(notices).toHaveLength(1);
  });

  it("sends a request again after a failed turn, waiting longer each time, and tells the leader once", async () => {
    // A Scribe whose backend fails at once (no login, an outage) used to be sent its message again
    // at once, over a thousand turns in ten minutes. Now each failure in a row doubles the wait,
    // other updates wait too, the leader is told once after three, and a finished turn ends it.
    const { service, injected, notices, store } = await setupService();
    const scribe = await enable(service, store, "leader");
    store.assign({ questId: "q-1", space: "MSI", name: "T7 run", by: "agent", byAgent: false, leaderId: "leader" });
    service.changed("leader");
    await vi.advanceTimersByTimeAsync(0);
    const request = injected.at(-1)!.text;
    const sent = () => injected.length;

    await service.scribeTurnEnded(scribe, { unfinished: true });
    const before = sent();
    expect((await service.activity("leader")).text).toMatch(/^Its last turn failed; trying again at/);
    store.assign({ questId: "q-2", space: "MSI", name: "T7 run", by: "agent", byAgent: false, leaderId: "leader" });
    service.changed("leader");
    await vi.advanceTimersByTimeAsync(29_000);
    expect(sent()).toBe(before); // nothing goes during the wait, not even new events
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sent()).toBe(before + 1);
    expect(injected.at(-1)!.text).toContain("Your last turn was interrupted or failed");
    expect(injected.at(-1)!.text).toContain(request);
    expect((await service.activity("leader")).text).toBe("Asked again; waiting for the Scribe");

    // Second failure: a minute; third: two minutes, and the leader is told, once.
    await service.scribeTurnEnded(scribe, { unfinished: true });
    await vi.advanceTimersByTimeAsync(59_000);
    expect(sent()).toBe(before + 1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sent()).toBe(before + 2);
    expect(notices).toHaveLength(0);
    await service.scribeTurnEnded(scribe, { unfinished: true });
    expect(notices).toHaveLength(1);
    expect(notices[0]!.text).toContain("last 3 turns failed");
    expect((await service.activity("leader")).text).toMatch(/^Its turns keep failing/);
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    await service.scribeTurnEnded(scribe, { unfinished: true });
    expect(notices).toHaveLength(1);

    // A finished turn ends the wait: what waited goes at once.
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    const resent = sent();
    await service.scribeTurnEnded(scribe);
    await vi.advanceTimersByTimeAsync(0);
    expect(sent()).toBe(resent + 1);
    expect(injected.at(-1)!.text).toContain("q-2");
  });

  it("waits while paused, and Update now goes through anyway", async () => {
    const { service, injected, store } = await setupService();
    await enable(service, store, "leader");
    store.setScribePaused("leader", true);
    injected.length = 0;
    const { topic } = store.assign({
      questId: "q-1",
      space: "MSI",
      name: "T7 run",
      by: "agent",
      byAgent: false,
      leaderId: "leader",
    });
    expect(await service.deliver("leader")).toBe("paused");
    expect(await service.requestUpdate("leader", topic.id)).toBe("sent");
    expect(injected).toHaveLength(1);
    expect(injected[0].text).toContain('The user asked to update now: "T7 run"');
  });

  it("reports what the Scribe is doing: initializing, updating, waiting, up to date", async () => {
    const { service, store, quests, busy } = await setupService();
    quests.push(
      { questId: "q-91", title: "A", createdAt: NOW, leaderSessionId: "leader", status: "done" },
      { questId: "q-92", title: "B", createdAt: NOW, leaderSessionId: "leader", status: "done" },
    );
    expect((await service.activity("leader")).state).toBe("off");
    await service.setLeaderEnabled("leader", true);
    store.assign({ questId: "q-91", space: "MSI", name: "Runs", by: "agent", byAgent: true, leaderId: "leader" });
    expect(await service.activity("leader")).toMatchObject({
      state: "initializing",
      text: "Sorting recent work into topics: 1 of 2 quests",
      sessionId: "scribe-leader-1",
    });
    store.assign({ questId: "q-92", space: "MSI", name: "Runs", by: "agent", byAgent: false, leaderId: "leader" });
    writePage(store, "Runs");
    await service.scribeTurnEnded("scribe-leader-1");
    busy.add("scribe-leader-1");
    expect((await service.activity("leader")).text).toBe("Updating Runs…");
    busy.clear();
    store.addEvent(store.findByName("MSI", "Runs")!.id, {
      at: Date.now() + 1,
      kind: "message",
      leaderId: "leader",
      text: "x",
    });
    await service.scribeTurnEnded("scribe-leader-1");
    expect(await service.activity("leader")).toMatchObject({ state: "waiting", pending: 1 });
    vi.advanceTimersByTime(10);
    writePage(store, "Runs");
    await service.scribeTurnEnded("scribe-leader-1");
    expect(await service.activity("leader")).toMatchObject({ state: "idle", text: "Up to date" });
  });

  it("reads a comment-only message's words from its comments, for events and the quote check", async () => {
    // A user can answer only with comments on passages; the message's own content is then empty.
    const message = {
      ...userMessage("", "q-2713", NOW),
      annotations: [{ id: "a1", selectedText: "ready to launch", comment: "Okay, let's launch it once merged." }],
    } as unknown as BrowserIncomingMessage;
    expect(historyMessageText(message)).toContain("[comment 1] Okay, let's launch it once merged.");

    const { service, store, leader } = await setupService();
    await enable(service, store, "leader");
    store.assign({ questId: "q-2713", space: "MSI", name: "T7 run", by: "agent", byAgent: false, leaderId: "leader" });
    leader.messageHistory.push(message);
    service.sessionSaved("leader");
    const topic = store.findByName("MSI", "T7 run")!;
    expect(store.pendingEvents(topic.id, "leader").at(-1)?.text).toContain("Okay, let's launch it once merged.");
  });

  it("checks that quoted decisions appear in the messages they link to", async () => {
    const { service, messages } = await setupService();
    messages.set("7:12", "Ok — keep 0.02, launch now. And   redo the plots");
    const page = [
      '- Oct 21 · "Keep 0.02, launch now" ([message](session:7:12)), and "redo the plots" ([message](session:7:12)).',
      '- Oct 22 · "Use 0.05 instead" ([message](session:7:12)).',
      '- Oct 23 · "Anything at all" ([message](session:7:99)) is not checked: that message cannot be read.',
      '- "keep 0.02 … the plots" ([message](session:7:12)) joins parts with an ellipsis.',
    ].join("\n");
    expect(service.checkQuotes(page)).toEqual(['"Use 0.05 instead" is not in message session:7:12']);
  });
});
