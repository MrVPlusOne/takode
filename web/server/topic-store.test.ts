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
  WRITER_CONTEXT_LIMIT,
  sessionSpend,
  type TopicSessionLike,
} from "./topic-service.js";
import { TOPIC_TENTATIVE_MS } from "../shared/library-topics.js";

/**
 * Library topics on disposable state: filing quests under topics in the user's words, tentative
 * topics, renames that never touch a name the user chose, merges and moves with Undo, and the
 * page writer being asked about a minute after events, within its budget and not while paused.
 */

const NOW = Date.UTC(2026, 9, 23, 19, 0);
let root: string;
let now = NOW;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "library-topics-"));
  now = NOW;
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(root, { recursive: true, force: true });
});

async function newStore() {
  const store = new TopicStore(root, () => now);
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

  it("never lets the page writer rename a topic the user named; renames keep the old name findable", async () => {
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
    expect(store.findByName("MSI", "Find 12B duties")?.name).toBe("T7 run");
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
    // The page writer may not fold it again, and it is no longer offered for folding; the user still can.
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

async function setupService() {
  vi.useFakeTimers({ now: NOW, toFake: ["setTimeout", "clearTimeout", "Date"] });
  const store = await newStore();
  const leader: TopicSessionLike = { id: "leader", messageHistory: [], state: { treeGroupId: "msi-group" } };
  const sessions = new Map<string, TopicSessionLike>([["leader", leader]]);
  const injected: Array<{ sessionId: string; text: string }> = [];
  let writers = 0;
  const contextTokens = new Map<string, number>();
  const retired: string[] = [];
  const service = new TopicService(store, {
    getSession: (id) => sessions.get(id),
    getLeaderInfo: (id) =>
      id === "leader"
        ? { sessionId: id, sessionNum: 7, name: "Daily Leader", space: "MSI", isOrchestrator: true, archived: false }
        : undefined,
    listLeaders: () => [
      { sessionId: "leader", sessionNum: 7, name: "Daily Leader", space: "MSI", isOrchestrator: true, archived: false },
    ],
    sessionNum: () => 7,
    listQuests: async () =>
      Array.from({ length: 25 }, (_, index) => ({
        questId: `q-${index}`,
        leaderSessionId: "leader",
      })) as unknown as QuestmasterTask[],
    inject: (sessionId, text) => {
      injected.push({ sessionId, text });
      return true;
    },
    createWriter: async () => {
      writers += 1;
      const id = `writer-${writers}`;
      sessions.set(id, { id, messageHistory: [], state: {} });
      return id;
    },
    isWriterAlive: (id) => sessions.has(id),
    writerContextTokens: (id) => contextTokens.get(id) ?? 0,
    retireWriter: async (id) => {
      retired.push(id);
      sessions.delete(id);
    },
    broadcastChanged: () => {},
    now: () => Date.now(),
  });
  return { store, service, leader, sessions, injected, contextTokens, retired };
}

describe("topic service", () => {
  it("suggests topics at about 20 quests and, once on, files the leader's month through the page writer", async () => {
    const { service, injected, store } = await setupService();
    expect((await service.leaderStates())[0]).toMatchObject({ enabled: false, questCount: 25, suggest: true });

    await service.setLeaderEnabled("leader", true);
    expect(store.isLeaderEnabled("leader")).toBe(true);
    // The writer is introduced, then asked to file the month.
    expect(injected.map((message) => message.sessionId)).toEqual(["writer-1", "writer-1"]);
    expect(injected[1].text).toContain("takode topic quests --leader leader");
    // Turning it off and on again files only what is still unfiled, with the same writer.
    await service.setLeaderEnabled("leader", false);
    expect(store.isLeaderEnabled("leader")).toBe(false);
    await service.setLeaderEnabled("leader", true);
    expect(injected.map((message) => message.sessionId)).toEqual(["writer-1", "writer-1", "writer-1"]);
    expect(injected[2].text).toContain("--unfiled");
  });

  it("asks the page writer about a minute after the user's messages in a topic's quest, batching them", async () => {
    const { service, injected, store, leader } = await setupService();
    await service.setLeaderEnabled("leader", true);
    store.assign({ questId: "q-2713", space: "MSI", name: "T7 run", by: "agent", byAgent: false });
    store.writePage(store.findByName("MSI", "T7 run")!.id, "## Where it stands\nFiled.", Date.now());
    // The writer answered the backfill, so new events may ask again.
    service.pageWritten("MSI");
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
    expect(injected).toHaveLength(1);
    expect(injected[0].text).toContain('"T7 run"');
    expect(injected[0].text).toContain("takode topic changes");
    const topic = store.findByName("MSI", "T7 run")!;
    expect(store.pendingEvents(topic.id).map((event) => event.text)).toEqual(
      expect.arrayContaining(["Keep 0.02, launch now", "Also redo the plots by data"]),
    );
  });

  it("waits while paused or over budget, and Update now goes through anyway", async () => {
    const { service, injected, store, sessions } = await setupService();
    await service.setLeaderEnabled("leader", true);
    injected.length = 0;
    const { topic } = store.assign({ questId: "q-1", space: "MSI", name: "T7 run", by: "agent", byAgent: false });

    store.setPaused("MSI", true);
    expect(await service.ask("MSI")).toBe("paused");
    store.setPaused("MSI", false);

    // The writer spent more than a tenth of what the leader spent today.
    sessions.get("leader")!.messageHistory.push(...turn(Date.now(), 1000));
    sessions.get(store.writerFor("MSI")!)!.messageHistory.push(...turn(Date.now(), 200));
    expect(service.budget("MSI")).toMatchObject({ overBudget: true });
    expect(await service.ask("MSI")).toBe("over_budget");
    expect(await service.ask("MSI", { force: true, topicId: topic.id })).toBe("asked");
    expect(injected).toHaveLength(1);
  });

  it("replaces a page writer whose conversation grew long, but never while it works on a request", async () => {
    const { service, store, injected, contextTokens, retired, sessions } = await setupService();
    await service.setLeaderEnabled("leader", true);
    const { topic } = store.assign({ questId: "q-1", space: "MSI", name: "T7 run", by: "agent", byAgent: false });
    // The backfill is still being answered: a fix request goes to the same writer.
    contextTokens.set("writer-1", WRITER_CONTEXT_LIMIT + 1);
    sessions.get("writer-1")!.messageHistory.push(...turn(Date.now(), 200));
    expect(await service.ask("MSI", { force: true, topicId: topic.id })).toBe("asked");
    expect(retired).toEqual([]);
    expect(injected.at(-1)?.sessionId).toBe("writer-1");

    // Once it has written, the next request starts a fresh writer, introduced first.
    service.pageWritten("MSI");
    expect(await service.ask("MSI", { force: true, topicId: topic.id })).toBe("asked");
    expect(retired).toEqual(["writer-1"]);
    expect(store.writerFor("MSI")).toBe("writer-2");
    // What the replaced writer spent still counts against the day's budget.
    expect(service.budget("MSI").used).toBe(1000);
    expect(injected.slice(-2).map((message) => message.sessionId)).toEqual(["writer-2", "writer-2"]);
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
