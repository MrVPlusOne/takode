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
 * the space's page writer is recognized by its session and may not rename a topic the user
 * named, and a written page covers exactly the events the writer read.
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
    },
    { questId: "q-2", title: "256K twin", status: "in_progress", sessionSpaceSlug: "MSI", createdAt: 2 },
  ];
  return {
    getQuest: async (id: string) => quests.find((quest) => quest.questId === id) ?? null,
    listQuests: async () => quests,
  };
});

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "topic-routes-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function setup() {
  const store = new TopicStore(root);
  await store.load();
  store.setWriter("MSI", "writer");
  const injected: string[] = [];
  const service = new TopicService(store, {
    getSession: () => undefined,
    getLeaderInfo: () => undefined,
    listLeaders: () => [],
    sessionNum: () => null,
    listQuests: async () => [],
    inject: (_sessionId, text) => {
      injected.push(text);
      return true;
    },
    createWriter: async () => "writer",
    isWriterAlive: () => true,
    writerContextTokens: () => 0,
    retireWriter: async () => {},
    broadcastChanged: () => {},
  });
  let caller: string | null = null;
  const ctx = {
    resolveId: (raw: string) => raw,
    authenticateCompanionCallerOptional: () => (caller ? { callerId: caller, caller: {} } : null),
    launcher: { getSession: () => ({ memorySessionSpaceSlug: "MSI" }), getSessionNum: () => 7 },
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

  it("refuses the page writer's rename of a topic the user named, but lets the user rename it", async () => {
    const { store, send, setCaller } = await setup();
    const { topic } = store.assign({ questId: "q-1", space: "MSI", name: "T7 run", by: "user", byAgent: false });

    setCaller("writer");
    const refused = await send(`/topics/${topic.id}`, "PATCH", { name: "Coding T7" });
    expect(refused.status).toBe(403);

    setCaller(null);
    const renamed = await (await send(`/topics/${topic.id}`, "PATCH", { name: "T7 coding run" })).json();
    expect(renamed.name).toBe("T7 coding run");
  });

  it("writes a page that covers what the writer read, so later events stay pending", async () => {
    const { app, store, send, setCaller } = await setup();
    const { topic } = store.assign({ questId: "q-1", space: "MSI", name: "T7 run", by: "agent", byAgent: false });
    store.addEvent(topic.id, { at: Date.now() + 10, kind: "message", questId: "q-1", sessionId: "leader", text: "Go" });

    setCaller("writer");
    const read = await (await app.request(`/topics/${topic.id.slice(0, 8)}/changes`)).json();
    expect(read.events.map((event: { kind: string }) => event.kind)).toEqual(["quest_filed", "message"]);
    expect(read.events[1].sessionNum).toBe(7);
    expect(read.quests).toEqual([{ questId: "q-1", title: "Launch T7", status: "done" }]);

    // An event that arrives while the writer is writing is not covered by the page.
    store.addEvent(topic.id, { at: Date.now() + 20, kind: "quest_done", questId: "q-1", text: "Launch T7" });
    const written = await send(`/topics/${topic.id}/page`, "POST", { markdown: "## Where it stands\nLaunched." });
    expect(written.status).toBe(200);
    expect(store.pendingEvents(topic.id).map((event) => event.kind)).toEqual(["quest_done"]);
  });

  it("shows a leader's Library the topics of its own quests", async () => {
    const { app, store } = await setup();
    store.assign({ questId: "q-1", space: "MSI", name: "T7 run", by: "agent", byAgent: false });
    store.assign({ questId: "q-2", space: "MSI", name: "Seeded QA", by: "agent", byAgent: false });
    const everything = await (await app.request("/topics?space=MSI")).json();
    expect(everything.topics.map((topic: { name: string }) => topic.name).sort()).toEqual(["Seeded QA", "T7 run"]);
    const own = await (await app.request("/topics?leader=leader")).json();
    expect(own.topics.map((topic: { name: string }) => topic.name)).toEqual(["T7 run"]);
  });
});
