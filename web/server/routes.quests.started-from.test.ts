import { Hono } from "hono";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import * as questStore from "./quest-store.js";
import type { QuestmasterTask } from "./quest-types.js";
import { createQuestRoutes } from "./routes/quests.js";
import { questSources } from "./quest-source-index.js";

// The leader's conversation: the user wrote u1 in Main and u2 in q-7's thread.
const HISTORY = [
  {
    type: "user_message",
    id: "msg-a",
    content: "File the relay fix",
    timestamp: 100,
    leaderResponseCoverageVersion: 1,
    leaderUserMessageId: "u1",
  },
  {
    type: "user_message",
    id: "msg-b",
    content: "And split the board change out",
    timestamp: 200,
    leaderResponseCoverageVersion: 1,
    leaderUserMessageId: "u2",
    threadKey: "q-7",
    questId: "q-7",
  },
];

const QUEST = { id: "q-9", questId: "q-9", version: 1, title: "Relay fix", status: "idea", createdAt: 1 };

const invalidateLeaderThreadTabsForQuestIds = vi.fn();

function makeApp() {
  const app = new Hono();
  app.route(
    "/api",
    createQuestRoutes({
      launcher: { getSession: vi.fn(), listSessions: vi.fn(() => []) },
      wsBridge: {
        _sessions: {},
        getSession: vi.fn((id: string) => (id === "leader-1" ? { id, state: {}, messageHistory: HISTORY } : null)),
        broadcastGlobal: vi.fn(),
        invalidateLeaderThreadTabsForQuestIds,
      },
      imageStore: undefined,
      authenticateCompanionCallerOptional: vi.fn(() => ({ callerId: "leader-1", caller: {} })),
      execCaptureStdoutAsync: vi.fn(),
      resolveId: (sessionId: string) => sessionId,
    } as any),
  );
  return app;
}

function send(app: Hono, method: "POST" | "PATCH", path: string, body: unknown) {
  return app.request(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("quests filed from a user's message", () => {
  it("records the message a new quest was filed from, resolved in the caller's conversation", async () => {
    // `quest create --source-message u2` sends the uN ID; the server stores the message's
    // history ID, the thread it was written in and its time next to the follow-ups.
    const create = vi.spyOn(questStore, "createQuest").mockResolvedValue(QUEST as QuestmasterTask);
    const response = await send(makeApp(), "POST", "/api/quests", {
      title: "Relay fix",
      relationships: { followUpOf: ["q-7"] },
      startedFromUserMessageId: "u2",
    });

    expect(response.status).toBe(201);
    const input = create.mock.calls[0]![0];
    expect(input.relationships).toEqual({
      followUpOf: ["q-7"],
      startedFrom: { sessionId: "leader-1", messageId: "msg-b", threadKey: "q-7", timestamp: 200 },
    });
    expect(input).not.toHaveProperty("startedFromUserMessageId");
  });

  it("records it on an existing quest through an edit", async () => {
    const patch = vi.spyOn(questStore, "patchQuest").mockResolvedValue(QUEST as QuestmasterTask);
    const response = await send(makeApp(), "PATCH", "/api/quests/q-9", { startedFromUserMessageId: "u1" });

    expect(response.status).toBe(200);
    expect(patch.mock.calls[0]![1]).toEqual({
      relationships: { startedFrom: { sessionId: "leader-1", messageId: "msg-a", threadKey: "main", timestamp: 100 } },
    });
  });

  it("remembers the source for the leader's tabs and refreshes the tabs that show the quest", async () => {
    // The leader tab projection is built synchronously, so it reads sources from memory;
    // recording one can turn the quest's open tab into a side quest.
    const startedFrom = { sessionId: "leader-1", messageId: "msg-b", threadKey: "q-7", timestamp: 200 };
    vi.spyOn(questStore, "patchQuest").mockResolvedValue({
      ...QUEST,
      questId: "q-90",
      relationships: { startedFrom },
    } as QuestmasterTask);
    await send(makeApp(), "PATCH", "/api/quests/q-90", { startedFromUserMessageId: "u2" });

    expect(questSources.get("q-90")).toEqual(startedFrom);
    expect(invalidateLeaderThreadTabsForQuestIds).toHaveBeenCalledWith(["q-90"]);
  });

  it("rejects an ID the caller's conversation does not have, without writing", async () => {
    const create = vi.spyOn(questStore, "createQuest");
    const response = await send(makeApp(), "POST", "/api/quests", { title: "X", startedFromUserMessageId: "u5" });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "No user message u5 in this session" });
    expect(create).not.toHaveBeenCalled();
  });

  it("lists the quests started from a leader's messages, saying which are side quests", async () => {
    // q-9 was filed from u1 in Main and is answered there: a side quest. q-10 was filed from
    // u2 in q-7's thread, and the user then wrote in q-10's own thread: a full quest.
    const startedFrom = { sessionId: "leader-1", messageId: "msg-a", threadKey: "main", timestamp: 100 };
    const fromQ7 = { sessionId: "leader-1", messageId: "msg-b", threadKey: "q-7", timestamp: 200 };
    vi.spyOn(questStore, "listQuests").mockResolvedValue([
      { ...QUEST, relationships: { startedFrom } } as QuestmasterTask,
      { ...QUEST, questId: "q-10", title: "Board change", relationships: { startedFrom: fromQ7 } } as QuestmasterTask,
    ]);
    HISTORY.push({
      type: "user_message",
      id: "msg-c",
      content: "Keep the board change small",
      timestamp: 300,
      leaderResponseCoverageVersion: 1,
      leaderUserMessageId: "u3",
      threadKey: "q-10",
      questId: "q-10",
    });
    onTestFinished(() => void HISTORY.pop());
    const response = await makeApp().request("/api/sessions/leader-1/started-quests");

    expect(await response.json()).toEqual({
      quests: [
        { questId: "q-9", title: "Relay fix", startedFrom, sideQuest: true },
        { questId: "q-10", title: "Board change", startedFrom: fromQ7, sideQuest: false },
      ],
    });
  });
});
