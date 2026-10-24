import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { BrowserIncomingMessage } from "./session-types.js";
import type { QuestmasterTask } from "./quest-types.js";
import { TopicStore, pageSummary } from "./topic-store.js";
import { PAGE_FORMAT, TopicService, sessionSpend, historyMessageText, type TopicSessionLike } from "./topic-service.js";
import { TOPIC_TENTATIVE_MS, type TopicRenameSuggestion } from "../shared/library-topics.js";

/**
 * Library topics on disposable state: filing quests under topics in the user's words, tentative
 * topics, renames that never touch a name the user chose, merges and moves with Undo, and the
 * leader's Scribe being told what changed as soon as it is idle, within its budget and not while paused.
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
function turn(at: number, output: number): BrowserIncomingMessage[] {
  return [{ type: "user_message", content: "go", timestamp: at } as BrowserIncomingMessage, result(output)];
}

function result(output: number): BrowserIncomingMessage {
  return {
    type: "result",
    data: {
      usage: { input_tokens: 0, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
  } as unknown as BrowserIncomingMessage;
}

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
  const service = new TopicService(store, {
    getSession: (id) => sessions.get(id),
    getLeaderInfo: (id) => LEADERS[id as keyof typeof LEADERS],
    listLeaders: () => Object.values(LEADERS),
    sessionNum: (id) => (id.startsWith("scribe") ? 100 + Number(id.split("-")[2]) : 7),
    leaderOf: (id) => (id in LEADERS ? id : undefined),
    listQuests: async () => quests as unknown as QuestmasterTask[],
    inject: (sessionId, text) => {
      injected.push({ sessionId, text });
      return true;
    },
    createScribe: async (info) => {
      const id = `scribe-${info.sessionId}-${created.length + 1}`;
      created.push(id);
      sessions.set(id, { id, messageHistory: [], state: {} });
      return id;
    },
    isScribeAlive: (id) => sessions.has(id),
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
  return { store, service, leader, sessions, quests, injected, notices, created, busy, retired, messages };
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
    expect(injected[0].text).toContain('grouping instructions: "One topic per training run."');

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

    // The user's messages in the quest's tab go out at once, with links to the messages.
    leader.messageHistory.push(userMessage("Keep 0.02, launch now", "q-2713", Date.now()));
    leader.messageHistory.push(userMessage("unrelated", "main", Date.now()));
    service.sessionSaved("leader");
    await vi.advanceTimersByTimeAsync(0);
    expect(injected).toHaveLength(1);
    expect(injected[0]).toMatchObject({ sessionId: scribe });
    expect(injected[0].text).toContain('the user wrote in q-2713 ([message](session:7:0)): "Keep 0.02, launch now"');
    expect(injected[0].text).not.toContain("unrelated");

    // While it works, the next message waits, and goes out when its turn ends.
    busy.add(scribe);
    leader.messageHistory.push(userMessage("Also redo the plots by data", "q-2713", Date.now()));
    service.sessionSaved("leader");
    await vi.advanceTimersByTimeAsync(0);
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
    ).toThrow(/updated this page since you read it/);
  });

  it("names new quests with no topic and changed grouping instructions, each once", async () => {
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
    expect(injected[0].text).toContain('grouping instructions changed: "One topic per training run."');
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
    expect(injected[0]!.text).toContain("rebuild Now from what its quests left open");

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

  it("sends a request again when the turn that took it was interrupted, then tells the leader", async () => {
    // At a restart a Scribe's turn can be cut off before it starts (its process was replaced); the
    // status must not say "Up to date" and the request must not be lost.
    const { service, injected, notices, store } = await setupService();
    const scribe = await enable(service, store, "leader");
    store.assign({ questId: "q-1", space: "MSI", name: "T7 run", by: "agent", byAgent: false, leaderId: "leader" });
    service.changed("leader");
    await vi.advanceTimersByTimeAsync(0);
    const request = injected.at(-1)!.text;
    expect((await service.activity("leader")).text).toBe("Request sent; waiting for the Scribe");

    await service.scribeTurnEnded(scribe, { unfinished: true });
    expect(injected.at(-1)!.text).toContain("Your last turn was interrupted or failed");
    expect(injected.at(-1)!.text).toContain(request);
    expect((await service.activity("leader")).text).toBe("Asked again; waiting for the Scribe");

    await service.scribeTurnEnded(scribe, { unfinished: true });
    expect(notices.at(-1)!.text).toContain("its turn was interrupted or failed before it finished");
    expect((await service.activity("leader")).text).toBe("Stopped before finishing; your leader was told");
  });

  it("waits while paused or over budget, and Update now goes through anyway", async () => {
    const { service, injected, store, sessions } = await setupService();
    const scribe = await enable(service, store, "leader");
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
    store.setScribePaused("leader", false);

    // The Scribe spent more than a tenth of what its leader spent today.
    sessions.get("leader")!.messageHistory.push(...turn(Date.now(), 1000));
    sessions.get(scribe)!.messageHistory.push(...turn(Date.now(), 200));
    expect(service.budget("leader")).toMatchObject({ overBudget: true });
    expect(await service.deliver("leader")).toBe("over_budget");
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

  it("weighs spend like token prices and ignores turns older than a day", () => {
    const session: TopicSessionLike = {
      id: "s",
      messageHistory: [...turn(NOW - 2 * 24 * 3600_000, 1000), ...turn(NOW, 100)],
      state: {},
    };
    expect(sessionSpend(session, NOW - 24 * 3600_000)).toBe(500);
  });
});
