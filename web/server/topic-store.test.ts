import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { BrowserIncomingMessage } from "./session-types.js";
import type { QuestmasterTask } from "./quest-types.js";
import { TopicStore, pageSummary } from "./topic-store.js";
import {
  TopicService,
  TOPIC_UPDATE_DELAY_MS,
  SCRIBE_CONTEXT_LIMIT,
  sessionSpend,
  historyMessageText,
  type TopicSessionLike,
} from "./topic-service.js";
import { TOPIC_TENTATIVE_MS } from "../shared/library-topics.js";

/**
 * Library topics on disposable state: filing quests under topics in the user's words, tentative
 * topics, renames that never touch a name the user chose, merges and moves with Undo, and the
 * leader's Scribe being asked about a minute after events, within its budget and not while paused.
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

    const first = store.suggestRename(topic.id, "Coding T7", "leader", "Two runs now share this topic");
    expect(store.suggestions("MSI")).toEqual([expect.objectContaining({ topicName: "T7 run", name: "Coding T7" })]);
    store.answerSuggestion(first.id, false);
    expect(store.suggestions("MSI")).toEqual([]);
    // A dismissed name is not suggested again; another one can be, and accepting renames as the user.
    expect(() => store.suggestRename(topic.id, "coding  t7", "leader")).toThrow(/dismissed/);
    const second = store.suggestRename(topic.id, "T7 coding run", "leader");
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
    // A Scribe may not fold it again, and it is no longer offered for folding; the user still can.
    expect(() => store.merge(twin.id, t7.id, true, "Folded")).toThrow(/undid/);
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

  it("counts events after the page and summarizes the page's Where it stands", async () => {
    const store = await newStore();
    const { topic } = store.assign({ questId: "q-1", space: "MSI", name: "T7 run", by: "agent", byAgent: false });
    expect(store.summary(store.resolve(topic.id)!).pendingEvents).toBe(1);
    store.writePage(topic.id, "## Where it stands\nStep ~165; the [twin](session:1:2) tracks T7.\n\n## Made\n- x", now);
    expect(store.list("MSI")[0]).toMatchObject({ pendingEvents: 0, summary: "Step ~165; the twin tracks T7." });
    expect(pageSummary("No headings here.\n\nSecond paragraph")).toBe("No headings here.");

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
  // 25 older quests make the leader worth a hint; recent ones are what a Scribe files.
  const quests: Quest[] = Array.from({ length: 25 }, (_, index) => ({
    questId: `q-${index}`,
    title: `Old quest ${index}`,
    createdAt: NOW - 40 * DAY,
    leaderSessionId: "leader",
    status: "done",
  }));
  const injected: Array<{ sessionId: string; text: string }> = [];
  const created: string[] = [];
  const busy = new Set<string>();
  const contextTokens = new Map<string, number>();
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
    scribeContextTokens: (id) => contextTokens.get(id) ?? 0,
    retireScribe: async (id) => {
      retired.push(id);
      sessions.delete(id);
    },
    messageText: (sessionNum, index) => messages.get(`${sessionNum}:${index}`) ?? null,
    broadcastChanged: () => {},
    now: () => Date.now(),
  });
  return { store, service, leader, sessions, quests, injected, created, busy, contextTokens, retired, messages };
}

/** Turns topics on for a leader and settles its first filing, so later tests start from quiet. */
async function enable(service: TopicService, store: TopicStore, leaderId: string) {
  await service.setLeaderEnabled(leaderId, true);
  const scribe = store.scribeSession(leaderId)!;
  service.scribeTurnEnded(scribe);
  return scribe;
}

describe("topic service", () => {
  it("suggests topics at about 20 quests; turning them on starts a Scribe that files the leader's month", async () => {
    const { service, injected, store, created, retired } = await setupService();
    expect((await service.leaderStates())[0]).toMatchObject({ enabled: false, questCount: 25, suggest: true });

    await service.setLeaderEnabled("leader", true);
    expect(created).toEqual(["scribe-leader-1"]);
    expect(injected.map((message) => message.sessionId)).toEqual(["scribe-leader-1"]);
    expect(injected[0].text).toContain("takode scribe quests --unfiled");

    // Off archives the Scribe; on again starts a new one, which files what is still unfiled.
    await service.setLeaderEnabled("leader", false);
    expect(retired).toEqual(["scribe-leader-1"]);
    expect(store.scribeSession("leader")).toBeUndefined();
    await service.setLeaderEnabled("leader", true);
    expect(created).toEqual(["scribe-leader-1", "scribe-leader-2"]);
    expect(injected.map((message) => message.sessionId)).toEqual(["scribe-leader-1", "scribe-leader-2"]);
  });

  it("asks a leader's Scribe a minute after the user's messages in its topic's quest, batching them", async () => {
    const { service, injected, store, leader } = await setupService();
    const scribe = await enable(service, store, "leader");
    store.assign({ questId: "q-2713", space: "MSI", name: "T7 run", by: "agent", byAgent: false, leaderId: "leader" });
    store.writePage(store.findByName("MSI", "T7 run")!.id, "## Where it stands\nFiled.", Date.now(), {
      leaderId: "leader",
    });
    injected.length = 0;
    vi.advanceTimersByTime(1000);

    leader.messageHistory.push(userMessage("Keep 0.02, launch now", "q-2713", Date.now()));
    service.sessionSaved("leader");
    leader.messageHistory.push(userMessage("Also redo the plots by data", "q-2713", Date.now()));
    service.sessionSaved("leader");
    // Messages in other tabs or without a topic are not events.
    leader.messageHistory.push(userMessage("unrelated", "main", Date.now()));
    service.sessionSaved("leader");

    expect(injected).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(TOPIC_UPDATE_DELAY_MS);
    expect(injected.map((message) => message.sessionId)).toEqual([scribe]);
    expect(injected[0].text).toContain('"T7 run"');
    expect(injected[0].text).toContain("takode scribe changes");
    const topic = store.findByName("MSI", "T7 run")!;
    expect(store.pendingEvents(topic.id, "leader").map((event) => event.text)).toEqual(
      expect.arrayContaining(["Keep 0.02, launch now", "Also redo the plots by data"]),
    );
  });

  it("shares a topic between leaders: each Scribe covers its own leader's events", async () => {
    const { service, injected, store } = await setupService();
    const a = await enable(service, store, "leader");
    const b = await enable(service, store, "other");
    const { topic } = store.assign({
      questId: "q-1",
      space: "MSI",
      name: "T7 run",
      by: "agent",
      byAgent: false,
      leaderId: "leader",
    });
    store.assign({ questId: "q-2", space: "MSI", name: "T7 run", by: "agent", byAgent: false, leaderId: "other" });
    injected.length = 0;

    expect(store.pendingEvents(topic.id, "leader").map((event) => event.questId)).toEqual(["q-1"]);
    expect(await service.ask("leader")).toBe("asked");
    expect(injected.map((message) => message.sessionId)).toEqual([a]);

    // A's page covers A's events only; B's Scribe still has its own to add.
    const revision = store.pageRevision(topic.id);
    store.writePage(topic.id, "## Where it stands\nA's part.", Date.now(), { leaderId: "leader", revision });
    expect(store.pendingEvents(topic.id, "leader")).toEqual([]);
    expect(store.pendingEvents(topic.id, "other").map((event) => event.questId)).toEqual(["q-2"]);
    expect(await service.ask("other")).toBe("asked");
    expect(injected.at(-1)?.sessionId).toBe(b);
    // A write based on the page before A's is refused, so B merges instead of overwriting.
    expect(() =>
      store.writePage(topic.id, "## Where it stands\nB only.", Date.now(), { leaderId: "other", revision }),
    ).toThrow(/updated this page since you read it/);
  });

  it("lists a leader's recent quests with no topic, and passes on changed grouping instructions", async () => {
    const { service, injected, store, quests } = await setupService();
    await enable(service, store, "leader");
    injected.length = 0;
    quests.push({
      questId: "q-90",
      title: "Check the twin",
      createdAt: NOW,
      leaderSessionId: "leader",
      status: "refined",
    });
    store.setScribeInstructions("leader", "One topic per training run.");
    service.instructionsChanged("leader");
    await vi.advanceTimersByTimeAsync(0);
    expect(injected).toHaveLength(1);
    expect(injected[0].text).toContain('grouping instructions changed: "One topic per training run."');
    expect(injected[0].text).toContain("- q-90 Check the twin");
  });

  it("counts a request answered when the Scribe's turn ends, even with no page written", async () => {
    // A turn that only files quests or folds topics writes no page; events that came in meanwhile
    // must still reach the Scribe, and the status must not wait for a page that never comes.
    const { service, injected, store, busy } = await setupService();
    const scribe = await enable(service, store, "leader");
    const { topic } = store.assign({
      questId: "q-1",
      space: "MSI",
      name: "T7 run",
      by: "agent",
      byAgent: false,
      leaderId: "leader",
    });
    injected.length = 0;
    expect(await service.ask("leader")).toBe("asked");
    busy.add(scribe);

    // An event while the Scribe works on that request waits for its turn to end.
    service.event(topic.id, "leader", { at: Date.now(), kind: "message", text: "Launch it" });
    await vi.advanceTimersByTimeAsync(TOPIC_UPDATE_DELAY_MS);
    expect(injected).toHaveLength(1);

    // The turn ends without a page: the held update goes out after the usual pause.
    busy.delete(scribe);
    service.scribeTurnEnded(scribe);
    expect((await service.activity("leader")).state).toBe("waiting");
    await vi.advanceTimersByTimeAsync(TOPIC_UPDATE_DELAY_MS);
    expect(injected).toHaveLength(2);
    expect(injected[1].text).toContain('"T7 run"');
  });

  it("tells a replacement Scribe the grouping instructions its predecessor was told", async () => {
    const { service, injected, store, contextTokens } = await setupService();
    const first = await enable(service, store, "leader");
    store.setScribeInstructions("leader", "One topic per training run.");
    service.instructionsChanged("leader");
    await vi.advanceTimersByTimeAsync(0);
    expect(injected.at(-1)).toMatchObject({
      sessionId: first,
      text: expect.stringContaining("One topic per training run."),
    });
    service.scribeTurnEnded(first);

    // The first Scribe grew too long and is replaced before the next request; the new one is told.
    contextTokens.set(first, SCRIBE_CONTEXT_LIMIT + 1);
    store.assign({ questId: "q-1", space: "MSI", name: "T7 run", by: "agent", byAgent: false, leaderId: "leader" });
    expect(await service.ask("leader")).toBe("asked");
    const second = store.scribeSession("leader")!;
    expect(second).not.toBe(first);
    expect(injected.at(-1)).toMatchObject({
      sessionId: second,
      text: expect.stringContaining('grouping instructions changed: "One topic per training run."'),
    });
  });

  it("waits while paused or over budget, and Update now goes through anyway", async () => {
    const { service, injected, store, sessions } = await setupService();
    const scribe = await enable(service, store, "leader");
    injected.length = 0;
    const { topic } = store.assign({
      questId: "q-1",
      space: "MSI",
      name: "T7 run",
      by: "agent",
      byAgent: false,
      leaderId: "leader",
    });

    store.setScribePaused("leader", true);
    expect(await service.ask("leader")).toBe("paused");
    store.setScribePaused("leader", false);

    // The Scribe spent more than a tenth of what its leader spent today.
    sessions.get("leader")!.messageHistory.push(...turn(Date.now(), 1000));
    sessions.get(scribe)!.messageHistory.push(...turn(Date.now(), 200));
    expect(service.budget("leader")).toMatchObject({ overBudget: true });
    expect(await service.ask("leader")).toBe("over_budget");
    expect(await service.ask("leader", { force: true, topicId: topic.id })).toBe("asked");
    expect(injected).toHaveLength(1);
  });

  it("replaces a Scribe whose conversation grew long, but never while it works on a request", async () => {
    const { service, store, injected, contextTokens, retired, sessions, created } = await setupService();
    await service.setLeaderEnabled("leader", true);
    const { topic } = store.assign({
      questId: "q-1",
      space: "MSI",
      name: "T7 run",
      by: "agent",
      byAgent: false,
      leaderId: "leader",
    });
    // The filing request is still open: a fix request goes to the same Scribe.
    contextTokens.set("scribe-leader-1", SCRIBE_CONTEXT_LIMIT + 1);
    sessions.get("scribe-leader-1")!.messageHistory.push(...turn(Date.now(), 200));
    expect(await service.ask("leader", { force: true, topicId: topic.id })).toBe("asked");
    expect(retired).toEqual([]);

    // Once its turn is over, the next request starts a fresh Scribe.
    service.scribeTurnEnded("scribe-leader-1");
    expect(await service.ask("leader", { force: true, topicId: topic.id })).toBe("asked");
    expect(retired).toEqual(["scribe-leader-1"]);
    expect(created.at(-1)).toBe("scribe-leader-2");
    expect(injected.at(-1)?.sessionId).toBe("scribe-leader-2");
    // What the replaced Scribe spent still counts against the day's budget.
    expect(service.budget("leader").used).toBe(1000);
  });

  it("reports what the Scribe is doing: filing, updating, waiting, up to date", async () => {
    const { service, store, quests, busy } = await setupService();
    quests.push(
      { questId: "q-91", title: "A", createdAt: NOW, leaderSessionId: "leader", status: "done" },
      { questId: "q-92", title: "B", createdAt: NOW, leaderSessionId: "leader", status: "done" },
    );
    expect((await service.activity("leader")).state).toBe("off");
    await service.setLeaderEnabled("leader", true);
    store.assign({ questId: "q-91", space: "MSI", name: "Runs", by: "agent", byAgent: false, leaderId: "leader" });
    expect(await service.activity("leader")).toMatchObject({
      state: "filing",
      text: "Filing 1 of 2 quests",
      sessionId: "scribe-leader-1",
    });
    service.scribeTurnEnded("scribe-leader-1");
    busy.add("scribe-leader-1");
    await service.ask("leader", { force: true });
    expect((await service.activity("leader")).text).toBe("Updating Runs…");
    busy.clear();
    service.scribeTurnEnded("scribe-leader-1");
    expect(await service.activity("leader")).toMatchObject({ state: "waiting", pending: 1 });
    store.writePage(store.findByName("MSI", "Runs")!.id, "## Where it stands\nOk.", Date.now(), {
      leaderId: "leader",
    });
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
