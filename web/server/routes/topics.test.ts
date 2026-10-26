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
    store.setLeaderEnabled("leader", true);
    const filed = await (await send("/topics/assign", "POST", { questId: "q-1", topic: "T7 run" })).json();
    expect(filed).toMatchObject({ created: true, topic: { name: "T7 run", space: "MSI", nameSource: "agent" } });

    const status = await (await app.request("/topics/caller-status")).json();
    expect(status).toEqual({ enabled: true, space: "MSI", topics: ["T7 run"] });
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

  it("lets a Scribe add, edit and remove Now entries for its leader, and keeps Now out of the page text", async () => {
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
    const added = await (
      await send(`/scribe/topics/${topic.id}/now`, "POST", { group: "waiting", who: "Parsewave", text: "images" })
    ).json();
    expect(added).toMatchObject({ group: "waiting", who: "Parsewave", leaderId: "leader" });
    expect((await send(`/scribe/topics/${topic.id}/now`, "POST", { group: "soon", text: "x" })).status).toBe(400);
    const edited = await (await send(`/scribe/topics/${topic.id}/now/${added.id}`, "PATCH", { group: "next" })).json();
    expect(edited).toMatchObject({ group: "next", text: "images" });

    // The panel gets the entries with the page; the Scribe sees them, marked as its leader's.
    setCaller("leader");
    expect((await (await app.request(`/topics/${topic.id}`)).json()).now).toHaveLength(1);
    setCaller("scribe");
    const read = await (await app.request(`/scribe/topics/${topic.id}/changes`)).json();
    expect(read.now).toMatchObject([{ id: added.id, yours: true }]);

    // A Now section written into the page would show twice: it is left out, with a warning.
    const saved = await (
      await send(`/scribe/topics/${topic.id}/page`, "POST", {
        markdown: "T7.\n\n## Now\n- **Next:** x\n\n## History\n- Oct 23",
      })
    ).json();
    expect(saved.page).toBe("T7.\n\n## History\n- Oct 23");
    expect(saved.warnings[0]).toContain("takode scribe now");

    expect((await send(`/scribe/topics/${topic.id}/now/${added.id}`, "DELETE", {})).status).toBe(200);
    expect(store.nowEntries(topic.id)).toEqual([]);
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
        checksLeft: ["Check the T7 dashboard on the phone"],
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
      markdown: "## Where it stands\nLaunched.",
    });
    expect(written.status).toBe(200);
    expect(store.pendingEvents(topic.id, "leader").map((event) => event.kind)).toEqual(["quest_done"]);
    expect(store.pendingEvents(topic.id, "other").map((event) => event.questId)).toEqual(["q-9"]);

    // Nothing to change for the rest: marking it read leaves the page as it is.
    await app.request(`/scribe/topics/${topic.id}/changes`);
    const unchanged = await send(`/scribe/topics/${topic.id}/page`, "POST", { unchanged: true });
    expect(unchanged.status).toBe(200);
    expect(store.pendingEvents(topic.id, "leader")).toEqual([]);
    expect(store.resolve(topic.id)?.page).toBe("## Where it stands\nLaunched.");
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
});
