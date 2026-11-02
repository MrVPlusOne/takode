import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { RouteContext } from "./context.js";
import { TopicStore } from "../topic-store.js";
import { TopicService } from "../topic-service.js";
import { createTopicRoutes } from "./topics.js";

/**
 * The topics API on a disposable store with mocked quests: a leader files a quest under a topic,
 * a leader's Scribe is recognized by its session and may not rename a topic the user named, and a
 * page it writes covers exactly the events it read.
 */

vi.mock("../quest-store.js", () => {
  const quests = [
    {
      questId: "q-1",
      title: "Launch T7",
      status: "done",
      sessionSpaceSlug: "MSI",
      createdAt: 1,
      leaderSessionId: "leader",
      // Finished just now: its wrap-up and unticked checks are what the Scribe builds Now from.
      completedAt: Date.now(),
      // Its status changed after the topic's own events (newer than any test's filing).
      statusChangedAt: Date.now() + 60_000,
      debriefTldr: "Launched; not tried on an iPhone.",
      verificationItems: [
        { text: "Check the T7 dashboard on the phone", checked: false },
        { text: "Restart the server", checked: true },
      ],
    },
    { questId: "q-2", title: "256K twin", status: "in_progress", sessionSpaceSlug: "MSI", createdAt: 2 },
  ];
  return {
    getQuest: async (id: string) => quests.find((quest) => quest.questId === id) ?? null,
    listQuests: async () => quests,
  };
});

let root: string;
/** Stores made by the current test, settled before their folder is removed. */
let stores: TopicStore[] = [];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "topic-routes-"));
  stores = [];
});

afterEach(async () => {
  await Promise.all(stores.map((store) => store.flush()));
  await rm(root, { recursive: true, force: true });
});

async function setup() {
  const store = new TopicStore(root);
  stores.push(store);
  await store.load();
  store.setScribeSession("leader", "scribe");
  const injected: string[] = [];
  const service = new TopicService(store, {
    getSession: () => undefined,
    getLeaderInfo: () => undefined,
    listLeaders: () => [],
    sessionNum: () => null,
    leaderOf: () => undefined,
    listQuests: async () => [],
    inject: (_sessionId, text) => {
      injected.push(text);
      return true;
    },
    createScribe: async () => "scribe",
    hostOf: () => undefined,
    isScribeAlive: () => true,
    isScribeBusy: () => false,
    isScribeRunning: () => false,
    relaunchScribe: async () => {},
    retireScribe: async () => {},
    notifyLeader: () => {},
    messageText: (sessionNum, index) => (sessionNum === 7 && index === 4 ? "Keep 0.02, launch now" : null),
    broadcastChanged: () => {},
  });
  let caller: string | null = null;
  const ctx = {
    resolveId: (raw: string) => raw,
    authenticateCompanionCallerOptional: () => (caller ? { callerId: caller, caller: {} } : null),
    launcher: {
      getSession: (id: string) => ({ memorySessionSpaceSlug: "MSI", isOrchestrator: id === "leader" }),
      getSessionNum: () => 7,
    },
    wsBridge: {
      // The leader discussed q-1 in one turn, opened by the user's message in its tab.
      getSession: (id: string) =>
        id === "leader"
          ? {
              messageHistory: [
                { type: "user_message", id: "u-main", content: "status?", timestamp: 1 },
                { type: "user_message", id: "u-q1", content: "launch", timestamp: 2, threadKey: "q-1", questId: "q-1" },
              ],
              notifications: [
                { id: "n1", category: "needs-input", summary: "Which context lengths?", threadKey: "q-2", done: false },
                { id: "n2", category: "review", summary: "Answer in main | Done", threadKey: "main", done: false },
                { id: "n3", category: "needs-input", summary: "Answered already", threadKey: "q-1", done: true },
              ],
              board: new Map([
                ["q-2", { questId: "q-2", title: "256K twin", status: "IMPLEMENTING", createdAt: 1, updatedAt: 1 }],
                ["q-3", { questId: "q-3", title: "Later", status: "QUEUED", createdAt: 2, updatedAt: 2 }],
              ]),
              pendingPermissions: new Map(),
            }
          : undefined,
      persistSessionById: () => {},
      broadcastToSession: () => {},
    },
  } as unknown as RouteContext;
  const app = createTopicRoutes(ctx, () => service);
  const send = (path: string, method: string, body: object) =>
    app.request(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { app, store, service, injected, send, setCaller: (id: string | null) => (caller = id) };
}

describe("topic routes", () => {
  it("files a leader's quest under a topic and tells quest create the leader's topics", async () => {
    const { app, store, send, setCaller } = await setup();
    setCaller("leader");
    store.enableLeader("leader");
    const filed = await (await send("/topics/assign", "POST", { questId: "q-1", topic: "T7 run" })).json();
    expect(filed).toMatchObject({ created: true, topic: { name: "T7 run", space: "MSI", nameSource: "agent" } });
    // A topic the leader started goes to its Scribe to check that it is distinct enough.
    expect(store.topicsToReview("leader").map((topic) => topic.name)).toEqual(["T7 run"]);

    const status = await (await app.request("/topics/caller-status")).json();
    expect(status).toEqual({ enabled: true, space: "MSI", topics: ["T7 run"] });

    // A quest the leader just created has no leader recorded until it is dispatched: its filing is
    // still the leader's event, so its Scribe hears of it and can check it belongs there.
    await send("/topics/assign", "POST", { questId: "q-2", topic: "T7 run" });
    const filed2 = store.pendingEvents(filed.topic.id).find((event) => event.questId === "q-2");
    expect(filed2).toMatchObject({ kind: "quest_filed", leaderId: "leader" });
  });

  it("turns a Scribe's rename of a topic the user named into a suggestion, while the user renames directly", async () => {
    const { app, store, send, setCaller } = await setup();
    const { topic } = store.assign({ questId: "q-1", space: "MSI", name: "T7 run", by: "user", byAgent: false });

    setCaller("scribe");
    const suggested = await (
      await send(`/topics/${topic.id}`, "PATCH", { name: "Coding T7", reason: "Two runs share it" })
    ).json();
    expect(suggested.suggested).toMatchObject({ topicName: "T7 run", name: "Coding T7", reason: "Two runs share it" });
    expect(store.resolve(topic.id)?.name).toBe("T7 run");

    // The panel shows it; accepting renames the topic in the user's name.
    setCaller(null);
    const list = await (await app.request("/topics?space=MSI")).json();
    expect(list.suggestions).toHaveLength(1);
    await send(`/topics/suggestions/${list.suggestions[0].id}`, "POST", { accept: true });
    expect(store.resolve(topic.id)).toMatchObject({ name: "Coding T7", nameSource: "user" });
  });

  it("moves several quests in one request as one change, made by the Scribe that sent it", async () => {
    const { app, store, send, setCaller } = await setup();
    store.assign({ questId: "q-1", space: "MSI", name: "T7 run", by: "agent", byAgent: false });
    store.assign({ questId: "q-2", space: "MSI", name: "Twin", by: "agent", byAgent: false });
    setCaller("scribe");
    const moved = await (
      await send("/topics/move", "POST", { questIds: ["q-1", "q-2"], topic: "Long context" })
    ).json();
    expect(moved).toMatchObject({ name: "Long context", questIds: ["q-1", "q-2"] });
    setCaller(null);
    const { changes } = await (await app.request("/topics?space=MSI")).json();
    expect(changes).toEqual([
      expect.objectContaining({
        text: 'Moved q-1 and q-2 to "Long context" from "T7 run" (1) and "Twin" (1)',
        byAgent: true,
      }),
    ]);
    // A quest that doesn't exist fails the whole request, naming it.
    const missing = await send("/topics/move", "POST", { questIds: ["q-1", "q-9"], topic: "T7 run" });
    expect(missing.status).toBe(404);
    expect((await missing.json()).error).toContain("q-9");
    expect(store.topicOfQuest("q-1")?.name).toBe("Long context");
  });

  it("lets the user dismiss changes from the panel without undoing them", async () => {
    const { app, store, send, setCaller } = await setup();
    const { topic } = store.assign({ questId: "q-1", space: "MSI", name: "T7 run", by: "user", byAgent: false });
    const { topic: twin } = store.assign({ questId: "q-2", space: "MSI", name: "Twin", by: "agent", byAgent: false });
    store.merge(twin.id, topic.id, true, "Folded");
    setCaller(null);
    const before = await (await app.request("/topics?space=MSI")).json();
    expect(before.changes).toHaveLength(1);
    expect((await send("/topics/changes/dismiss", "POST", { ids: [before.changes[0].id] })).status).toBe(200);
    expect((await (await app.request("/topics?space=MSI")).json()).changes).toEqual([]);
    expect(store.topicOfQuest("q-2")?.name).toBe("T7 run");
    expect((await send("/topics/changes/dismiss", "POST", {})).status).toBe(400);
  });

  it("saves a page whose quoted decision is not in its linked message, and warns about it", async () => {
    // A warning instead of a refusal: the Scribe fixes the quote, and a wrong check can't make it loop.
    const { store, send } = await setup();
    const { topic } = store.assign({ questId: "q-1", space: "MSI", name: "T7 run", by: "agent", byAgent: false });
    const bad = await send(`/scribe/topics/${topic.id}/page`, "POST", {
      markdown: '## Your decisions\n- "Use 0.05 instead" ([message](session:7:4))',
    });
    expect(bad.status).toBe(200);
    expect((await bad.json()).warnings).toEqual([
      expect.stringContaining('"Use 0.05 instead" is not in message session:7:4'),
    ]);
    expect(store.resolve(topic.id)?.page).toContain("Use 0.05 instead");
    const good = await send(`/scribe/topics/${topic.id}/page`, "POST", {
      markdown: '## Your decisions\n- "keep 0.02, launch now" ([message](session:7:4))',
    });
    expect((await good.json()).warnings).toEqual([]);
  });

  it("tells a Scribe, without an error, when the user already dismissed a name or undid a fold", async () => {
    const { store, send, setCaller } = await setup();
    const { topic } = store.assign({ questId: "q-1", space: "MSI", name: "T7 run", by: "user", byAgent: false });
    const { topic: twin } = store.assign({ questId: "q-2", space: "MSI", name: "Twin", by: "agent", byAgent: false });
    const suggestion = store.suggestRename(topic.id, "Coding T7", "leader") as { id: string };
    store.answerSuggestion(suggestion.id, false);
    store.merge(twin.id, topic.id, true, "Folded");
    store.undo(store.changes("MSI")[0]!.id);

    setCaller("scribe");
    const renamed = await send(`/topics/${topic.id}`, "PATCH", { name: "Coding T7" });
    expect(renamed.status).toBe(200);
    expect((await renamed.json()).skipped).toContain("dismissed");
    const merged = await send(`/topics/${twin.id}/merge`, "POST", { into: topic.id, fold: true });
    expect(merged.status).toBe(200);
    expect((await merged.json()).skipped).toContain("undid");
    expect(store.topicOfQuest("q-2")?.name).toBe("Twin");
  });

  it("tells a leader or its Scribe the Scribe's status, and lets either set instructions or pause", async () => {
    const { app, send, setCaller } = await setup();
    setCaller("leader");
    await send("/scribe/leader/instructions", "POST", { text: "One topic per training run." });
    const status = await (await app.request("/scribe/status")).json();
    expect(status).toMatchObject({
      scribe: { instructions: "One topic per training run.", paused: false, activity: { state: "off" } },
    });
    await send("/scribe/leader/pause", "POST", { paused: true });
    expect((await (await app.request("/scribe/status")).json()).scribe.paused).toBe(true);
    // The Scribe saves lasting requirements itself (its brief says when), and reads its own
    // leader's status without naming it.
    setCaller("scribe");
    expect((await send("/scribe/leader/instructions", "POST", { text: "Interviews in one topic." })).status).toBe(200);
    const own = await (await app.request("/scribe/status")).json();
    expect(own).toMatchObject({
      leader: { sessionId: "leader" },
      scribe: { instructions: "Interviews in one topic." },
    });
  });

  it("counts a topic's quests' own changes as activity, for topics older than their events", async () => {
    // Events exist only since topics were turned on; a quest that finished before that still says
    // when its topic was last active.
    const { app, store, setCaller } = await setup();
    store.assign({ questId: "q-1", space: "MSI", name: "T7 run", by: "agent", byAgent: false, leaderId: "leader" });
    setCaller("leader");
    const listed = (await (await app.request("/topics?leader=leader")).json()).topics[0];
    expect(listed).toMatchObject({ name: "T7 run", latestActivity: { text: "q-1 finished", questId: "q-1" } });
    expect(listed.activityAt).toBeGreaterThan(Date.now());
  });

  it("lets a Scribe write where a topic stands, and keeps it and Now out of the page text", async () => {
    const { app, store, send, setCaller } = await setup();
    const { topic } = store.assign({
      questId: "q-1",
      space: "MSI",
      name: "T7 run",
      by: "agent",
      byAgent: false,
      leaderId: "leader",
    });
    setCaller("scribe");
    const read = await (await app.request(`/scribe/topics/${topic.id}/changes`)).json();
    expect(read.stands).toEqual([]);
    const saved = await (
      await send(`/scribe/topics/${topic.id}/stands`, "POST", { lines: ["Waits on Parsewave's images"] })
    ).json();
    expect(saved).toEqual({ lines: ["Waits on Parsewave's images"] });
    // Writing it covers what the Scribe read, like a page save.
    expect(store.pendingEvents(topic.id, "leader")).toEqual([]);
    expect((await send(`/scribe/topics/${topic.id}/stands`, "POST", { lines: ["a", "b", "c", "d"] })).status).toBe(400);
    expect((await send(`/scribe/topics/${topic.id}/stands`, "POST", { text: "x" })).status).toBe(400);

    // The panel gets it with the page, with its leader's number; the Scribe sees it as its own.
    setCaller("leader");
    expect((await (await app.request(`/topics/${topic.id}`)).json()).stands).toMatchObject([
      { leaderId: "leader", leaderNum: 7, lines: ["Waits on Parsewave's images"] },
    ]);
    setCaller("scribe");
    expect((await (await app.request(`/scribe/topics/${topic.id}/changes`)).json()).stands).toMatchObject([
      { lines: ["Waits on Parsewave's images"], yours: true },
    ]);

    // A Now or Where it stands section written into the page would show twice: it is left out.
    const page = await (
      await send(`/scribe/topics/${topic.id}/page`, "POST", {
        markdown: "T7.\n\n## Now\n- **Next:** x\n\n## Where it stands\n- y\n\n## History\n- Oct 23",
      })
    ).json();
    expect(page.page).toBe("T7.\n\n## History\n- Oct 23");
    expect(page.warnings).toEqual([
      expect.stringContaining('"Now" section was left out'),
      expect.stringContaining('"Where it stands" section was left out'),
    ]);
  });

  it("gives the page each finished quest's one-line wrap-up for its quest log", async () => {
    const { app, store, setCaller } = await setup();
    const { topic } = store.assign({ questId: "q-1", space: "MSI", name: "T7 run", by: "agent", byAgent: false });
    setCaller("leader");
    const detail = await (await app.request(`/topics/${topic.id}`)).json();
    expect(detail.quests).toEqual([
      expect.objectContaining({
        questId: "q-1",
        status: "done",
        completedAt: expect.any(Number),
        wrapUp: "Launched; not tried on an iPhone.",
      }),
    ]);
  });
  // Jiayi (Nov 2): the page listed open quests as "in progress" only; each carries its news line,
  // as Home shows it: any leader's Scribe line for it, else a stand-in. A finished quest has none
  // (its wrap-up is in the quest log).
  it("gives each open quest its line of news, the Scribe's when written", async () => {
    const { app, store, setCaller } = await setup();
    const { topic } = store.assign({ questId: "q-2", space: "MSI", name: "T7 run", by: "agent", byAgent: false });
    store.assign({ questId: "q-1", space: "MSI", name: "T7 run", by: "agent", byAgent: false });
    setCaller("leader");
    const quests = async () =>
      Object.fromEntries(
        (
          (await (await app.request(`/topics/${topic.id}`)).json()).quests as Array<{ questId: string; news?: string }>
        ).map((quest) => [quest.questId, quest.news]),
      );
    // q-2 has no agent note yet, so no stand-in either.
    expect(await quests()).toEqual({ "q-1": undefined, "q-2": undefined });
    store.setHomeLines("other", [{ key: "q-2", text: "Older line." }]);
    store.setHomeLines("leader", [{ key: "q-2", text: "The twin reached 0.32." }]);
    store.setHomeLines("leader", [{ key: "q-1", text: "Not shown: q-1 is done." }]);
    expect(await quests()).toEqual({ "q-1": undefined, "q-2": "The twin reached 0.32." });
  });

  it("keeps the user's requests for one page, which the Scribe sees with every read of it", async () => {
    const { app, store, send, setCaller } = await setup();
    const { topic } = store.assign({
      questId: "q-1",
      space: "MSI",
      name: "Daily briefing",
      by: "agent",
      byAgent: false,
      leaderId: "leader",
    });
    setCaller("leader");
    const saved = await send(`/topics/${topic.id}/instructions`, "POST", {
      text: "Keep links to the two newest reports.",
    });
    expect(saved.status).toBe(200);
    expect((await (await app.request(`/topics/${topic.id}`)).json()).instructions).toBe(
      "Keep links to the two newest reports.",
    );
    setCaller("scribe");
    const read = await (await app.request(`/scribe/topics/${topic.id}/changes`)).json();
    expect(read.pageRequests).toBe("Keep links to the two newest reports.");
  });

  it("writes a page that covers what the Scribe read of its leader's events, so later events stay pending", async () => {
    const { app, store, send, setCaller } = await setup();
    const { topic } = store.assign({
      questId: "q-1",
      space: "MSI",
      name: "T7 run",
      by: "agent",
      byAgent: false,
      leaderId: "leader",
    });
    store.addEvent(topic.id, {
      at: Date.now() + 10,
      kind: "message",
      leaderId: "leader",
      questId: "q-1",
      sessionId: "leader",
      text: "Go",
    });
    // Another leader's event is for that leader's Scribe.
    store.addEvent(topic.id, { at: Date.now() + 11, kind: "quest_done", leaderId: "other", questId: "q-9" });
    store.setScribeInstructions("leader", "Keep links to the two newest daily reports on the page.");

    setCaller("scribe");
    const read = await (await app.request(`/scribe/topics/${topic.id.slice(0, 8)}/changes`)).json();
    // The user's lasting instructions come with every page read, so they hold after compaction.
    expect(read.instructions).toBe("Keep links to the two newest daily reports on the page.");
    expect(read.events.map((event: { kind: string }) => event.kind)).toEqual(["quest_filed", "message"]);
    expect(read.events[1].sessionNum).toBe(7);
    expect(read.quests).toEqual([
      {
        questId: "q-1",
        title: "Launch T7",
        status: "done",
        completedAt: expect.any(Number),
        wrapUp: "Launched; not tried on an iPhone.",
      },
    ]);

    // An event that arrives while the Scribe is writing is not covered by the page.
    store.addEvent(topic.id, {
      at: Date.now() + 20,
      kind: "quest_done",
      leaderId: "leader",
      questId: "q-1",
      text: "Launch T7",
    });
    const written = await send(`/scribe/topics/${topic.id}/page`, "POST", {
      markdown: "T7.\n\n## History\n- Launched.",
    });
    expect(written.status).toBe(200);
    expect(store.pendingEvents(topic.id, "leader").map((event) => event.kind)).toEqual(["quest_done"]);
    expect(store.pendingEvents(topic.id, "other").map((event) => event.questId)).toEqual(["q-9"]);

    // Nothing to change for the rest: marking it read leaves the page as it is.
    await app.request(`/scribe/topics/${topic.id}/changes`);
    const unchanged = await send(`/scribe/topics/${topic.id}/page`, "POST", { unchanged: true });
    expect(unchanged.status).toBe(200);
    expect(store.pendingEvents(topic.id, "leader")).toEqual([]);
    expect(store.resolve(topic.id)?.page).toBe("T7.\n\n## History\n- Launched.");
  });

  it("shows a leader's panel the topics of its own quests", async () => {
    const { app, store } = await setup();
    store.assign({ questId: "q-1", space: "MSI", name: "T7 run", by: "agent", byAgent: false });
    store.assign({ questId: "q-2", space: "MSI", name: "Seeded QA", by: "agent", byAgent: false });
    const everything = await (await app.request("/topics?space=MSI")).json();
    expect(everything.topics.map((topic: { name: string }) => topic.name).sort()).toEqual(["Seeded QA", "T7 run"]);
    const own = await (await app.request("/topics?leader=leader")).json();
    expect(own.topics.map((topic: { name: string }) => topic.name)).toEqual(["T7 run"]);
  });

  // New thread: the user starts a thread on purpose, a lightweight conversation of the leader that
  // is not a topic. It joins a topic when filed there, or by following the first quest started
  // from it.
  it("starts, lists and files a leader's threads, and lets a quest started from one pull it along", async () => {
    const { app, store, send } = await setup();
    const refused = await send("/topics/threads", "POST", { leader: "leader", name: "Quick question" });
    expect(refused.status).toBe(404);

    store.enableLeader("leader");
    const { thread } = await (
      await send("/topics/threads", "POST", { leader: "leader", name: "Quick question", startedFrom: "Q-2" })
    ).json();
    expect(thread).toMatchObject({ name: "Quick question", leaderId: "leader", startedFrom: "q-2" });
    expect((await (await app.request("/topics?leader=leader")).json()).topics).toEqual([]);
    const [listed] = (await (await app.request("/topics/threads?leader=leader")).json()).threads;
    // The Threads view orders idle threads by interaction: with no message yet, its creation.
    expect(listed.interactionAt).toBe(listed.createdAt);

    // q-1 was started from a message in the thread: filing it pulls the thread into its topic.
    const quest = (await import("../quest-store.js")) as unknown as { getQuest: (id: string) => Promise<unknown> };
    const q1 = (await quest.getQuest("q-1")) as { relationships?: unknown };
    q1.relationships = { startedFrom: { sessionId: "leader", messageId: "m", threadKey: thread.key, timestamp: 1 } };
    await send("/topics/assign", "POST", { questId: "q-1", topic: "T7 run" });
    const [filed] = (await (await app.request("/topics/threads?leader=leader")).json()).threads;
    expect(filed.topic).toMatchObject({ name: "T7 run" });
    const own = await (await app.request("/topics?leader=leader")).json();
    expect(own.topics[0]).toMatchObject({ name: "T7 run", threads: [{ name: "Quick question" }] });
  });

  it("starts a thread about a Library artifact, which its thread list and the leader's tag name", async () => {
    // Questions asked from an artifact's view go to a thread tied to that artifact: the view finds
    // it again in the leader's thread list, and the leader is told which artifact it is about.
    const { app, store, send } = await setup();
    store.enableLeader("leader");
    const artifact = { id: "c0a3178d-6b34-436f-9c7b-640c4510a376", title: "The Rocq proof eval, explained" };
    const { thread } = await (
      await send("/topics/threads", "POST", { leader: "leader", name: artifact.title, startedFrom: "q-2", artifact })
    ).json();
    expect(thread).toMatchObject({ startedFrom: "q-2", artifact });
    const [listed] = (await (await app.request("/topics/threads?leader=leader")).json()).threads;
    expect(listed.artifact).toEqual(artifact);
    // A malformed artifact is left out rather than stored.
    const plain = (
      await (await send("/topics/threads", "POST", { leader: "leader", name: "x", artifact: { id: 1 } })).json()
    ).thread;
    expect(plain.artifact).toBeUndefined();
  });

  // Jiayi: a leader's proposals and questions with no home went to Main, so they showed up in
  // whatever topic was on screen. A leader opens a thread for them instead, filed under a topic.
  it("lets a leader open a thread of its own, filed under a topic, and leaves none behind for an unknown topic", async () => {
    const { app, store, send, setCaller } = await setup();
    store.enableLeader("leader");
    store.assign({ questId: "q-2", space: "MSI", name: "T7 run", by: "agent", byAgent: false });
    setCaller("leader");
    const { thread } = await (
      await send("/topics/threads", "POST", { leader: "leader", name: "Faster eval sweeps", topic: "T7 run" })
    ).json();
    expect(thread).toMatchObject({ name: "Faster eval sweeps", startedBy: "leader", topic: { name: "T7 run" } });

    const refused = await send("/topics/threads", "POST", { leader: "leader", name: "Stray", topic: "No such topic" });
    expect(refused.status).toBe(404);
    const threads = (await (await app.request("/topics/threads?leader=leader")).json()).threads;
    expect(threads.map((entry: { name: string }) => entry.name)).toEqual(["Faster eval sweeps"]);

    // The user starting one (the browser, not the leader) is not the leader's.
    setCaller(null);
    const mine = (await (await send("/topics/threads", "POST", { leader: "leader", name: "Mine" })).json()).thread;
    expect(mine.startedBy).toBeUndefined();
  });

  // The Scribe joins a new thread onto the earlier conversation it continues; the leader hears with
  // its next delivery, and the user's Undo makes it a thread of its own again.
  it("lets a leader's Scribe join a thread onto an earlier one, and the user undo it", async () => {
    const { store, service, send, setCaller } = await setup();
    store.enableLeader("leader");
    const earlier = store.startThread({ space: "MSI", name: "Composer sits low", leaderId: "leader" });
    const later = store.startThread({ space: "MSI", name: "Composer a bit high", leaderId: "leader" });
    setCaller("scribe");
    const joined = await send("/scribe/join", "POST", { thread: later.key, into: earlier.key });
    // The Scribe reads both threads back by their addresses.
    expect(await joined.json()).toMatchObject({ thread: later.address, into: earlier.address });
    expect((await send("/scribe/join", "POST", { thread: later.key, into: "q-2" })).status).toBe(409);
    expect(service.rideAlongNotes().take("leader")).toContain("Composer a bit high");

    setCaller(null);
    const undone = await send("/topics/threads/unjoin", "POST", { leader: "leader", thread: later.key });
    expect((await undone.json()).thread.joinedInto).toBeUndefined();
    expect(service.rideAlongNotes().take("leader")).toContain("undid");
    expect((await send("/topics/threads/unjoin", "POST", { leader: "leader" })).status).toBe(400);
  });

  // The Scribe can undo a join of its own it found wrong, saying why; its leader hears the reason.
  it("lets a Scribe undo its own wrong join, with a reason its leader hears", async () => {
    const { store, service, send, setCaller } = await setup();
    store.enableLeader("leader");
    const earlier = store.startThread({ space: "MSI", name: "Composer sits low", leaderId: "leader" });
    const later = store.startThread({ space: "MSI", name: "Composer a bit high", leaderId: "leader" });
    setCaller("scribe");
    await send("/scribe/join", "POST", { thread: later.key, into: earlier.key });
    service.rideAlongNotes().take("leader");
    expect((await send("/scribe/unjoin", "POST", { thread: later.key })).status).toBe(400);
    const undone = await send("/scribe/unjoin", "POST", { thread: later.key, reason: "its request went to q-2896" });
    expect(await undone.json()).toMatchObject({ thread: later.address, from: earlier.address });
    expect(service.rideAlongNotes().take("leader")).toContain("undid its join of");
  });

  // Home shows a line of news per thread: the Scribe's once written, a stand-in before that.
  it("takes a Scribe's lines for its leader's Home, which win over the stand-ins", async () => {
    const { app, store, send, setCaller } = await setup();
    store.enableLeader("leader");
    const lines = async () => (await (await app.request("/topics/home-lines?leader=leader&quests=q-1")).json()).lines;
    // q-1 is done with a debrief summary: its stand-in.
    expect((await lines())["q-1"]).toMatchObject({ text: "Launched; not tried on an iPhone.", source: "debrief" });
    setCaller("scribe");
    const saved = await send("/scribe/lines", "POST", {
      lines: [{ key: "Q-1", text: "T7 is live; the phone check is left." }],
    });
    expect(await saved.json()).toEqual({ saved: 1 });
    expect((await lines())["q-1"]).toMatchObject({ text: "T7 is live; the phone check is left.", source: "scribe" });
    // A thread's line may name it by address (`t-N`); it is kept under the thread's key.
    const thread = store.startThread({ space: "MSI", name: "Relay", leaderId: "leader" });
    const byAddress = await send("/scribe/lines", "POST", { lines: [{ key: thread.address, text: "Relay is up." }] });
    expect(await byAddress.json()).toEqual({ saved: 1 });
    expect(store.homeLines("leader")[thread.key]).toMatchObject({ text: "Relay is up." });
    // One short plain line for a quest or a thread.
    for (const bad of [
      { key: "T7", text: "x" },
      { key: "t-999", text: "x" },
      { key: "q-1", text: "two\nlines" },
      { key: "q-1", text: "x".repeat(141) },
    ]) {
      expect((await send("/scribe/lines", "POST", { lines: [bad] })).status).toBe(400);
    }
  });
});
