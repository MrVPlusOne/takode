import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQuestRoutes } from "./routes/quests.js";
import * as questStore from "./quest-store.js";
import type { QuestmasterTask, QuestStatus } from "./quest-types.js";

function makeQuest(input: {
  questId: string;
  title: string;
  status?: QuestStatus;
  createdAt?: number;
  updatedAt?: number;
  tags?: string[];
  description?: string;
  feedbackText?: string;
}): QuestmasterTask {
  return {
    id: input.questId,
    questId: input.questId,
    version: 1,
    title: input.title,
    status: input.status ?? "idea",
    createdAt: input.createdAt ?? 1,
    updatedAt: input.updatedAt,
    description: input.description ?? "",
    tags: input.tags,
    ...(input.feedbackText
      ? {
          feedback: [
            {
              author: "human",
              text: input.feedbackText,
              ts: 2,
              addressed: false,
            },
          ],
        }
      : {}),
  } as QuestmasterTask;
}

function makeApp(quests: QuestmasterTask[]) {
  vi.spyOn(questStore, "listQuests").mockResolvedValue(quests);
  const app = new Hono();
  app.route(
    "/api",
    createQuestRoutes({
      launcher: {
        getSession: vi.fn(() => null),
        listSessions: vi.fn(() => []),
      } as any,
      wsBridge: {
        getSession: vi.fn(() => null),
        broadcastToSession: vi.fn(),
        persistSessionById: vi.fn(),
      } as any,
      imageStore: undefined,
      authenticateCompanionCallerOptional: vi.fn(() => null),
      execCaptureStdoutAsync: vi.fn(),
    } as any),
  );
  return app;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/quests/_page", () => {
  it("returns a bounded page with global counts and tag metadata", async () => {
    const app = makeApp([
      makeQuest({ questId: "q-1", title: "Active", status: "in_progress", updatedAt: 100, tags: ["work"] }),
      makeQuest({ questId: "q-2", title: "Done old", status: "done", updatedAt: 10, tags: ["archive"] }),
      makeQuest({ questId: "q-3", title: "Done new", status: "done", updatedAt: 90, tags: ["work"] }),
    ]);

    const res = await app.request("/api/quests/_page?limit=2&offset=0");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      quests: [{ questId: "q-1" }, { questId: "q-3" }],
      total: 3,
      offset: 0,
      limit: 2,
      hasMore: true,
      nextOffset: 2,
      previousOffset: null,
      counts: { all: 3, in_progress: 1, done: 2, idea: 0, refined: 0 },
      allTags: ["archive", "work"],
    });
    expect(body.quests[0]).toMatchObject({ preview: true, title: "Active" });
    expect(body.quests[0]).not.toHaveProperty("description");
    expect(body.quests[0]).not.toHaveProperty("feedback");
  });

  it("returns 304 when the page ETag matches", async () => {
    const app = makeApp([makeQuest({ questId: "q-1", title: "Active", status: "in_progress", updatedAt: 100 })]);

    const first = await app.request("/api/quests/_page?limit=2&offset=0");
    const etag = first.headers.get("etag");
    expect(first.status).toBe(200);
    expect(etag).toBeTruthy();

    const second = await app.request("/api/quests/_page?limit=2&offset=0", {
      headers: { "If-None-Match": etag ?? "" },
    });

    expect(second.status).toBe(304);
    expect(await second.text()).toBe("");
  });

  it("converts legacy GET /api/quests to a bounded preview page", async () => {
    const quests = Array.from({ length: 75 }, (_, index) =>
      makeQuest({
        questId: `q-${index + 1}`,
        title: `Quest ${index + 1}`,
        status: index % 2 === 0 ? "in_progress" : "done",
        description: `Large body ${index}`,
        feedbackText: `Feedback body ${index}`,
      }),
    );
    const app = makeApp(quests);

    const res = await app.request("/api/quests");

    expect(res.status).toBe(200);
    expect(res.headers.get("x-companion-deprecated")).toContain("bounded preview page");
    const body = await res.json();
    expect(body.quests).toHaveLength(50);
    expect(body.total).toBe(75);
    expect(body.quests[0]).toMatchObject({ preview: true });
    expect(body.quests[0]).not.toHaveProperty("description");
    expect(body.quests[0]).not.toHaveProperty("feedback");
  });

  it("applies backend text search, tag filters, status filters, and pagination", async () => {
    const app = makeApp([
      makeQuest({ questId: "q-1", title: "Match title", status: "idea", tags: ["ui"] }),
      makeQuest({ questId: "q-2", title: "Other", status: "done", tags: ["ui"], feedbackText: "match feedback" }),
      makeQuest({ questId: "q-3", title: "Match excluded", status: "idea", tags: ["skip"] }),
      makeQuest({ questId: "q-4", title: "Match excluded with included tag", status: "idea", tags: ["ui", "skip"] }),
    ]);

    const res = await app.request("/api/quests/_page?text=match&tags=ui&excludeTags=skip&status=idea,done&limit=10");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      quests: [{ questId: "q-1" }, { questId: "q-2" }],
      total: 2,
      counts: { all: 2, idea: 1, done: 1, refined: 0, in_progress: 0 },
    });
  });

  it("supports compact sort columns before slicing the page", async () => {
    const app = makeApp([
      makeQuest({ questId: "q-2", title: "Bravo", status: "done", updatedAt: 30 }),
      makeQuest({ questId: "q-1", title: "Alpha", status: "idea", updatedAt: 10 }),
      makeQuest({ questId: "q-3", title: "Charlie", status: "refined", updatedAt: 20 }),
    ]);

    const res = await app.request("/api/quests/_page?sortColumn=title&sortDirection=asc&limit=2");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      quests: [{ questId: "q-1" }, { questId: "q-2" }],
      total: 3,
      nextOffset: 2,
    });
  });

  it("supports active and previous owner session filters", async () => {
    const activeOwner = {
      ...makeQuest({ questId: "q-1", title: "Active owner", status: "in_progress" }),
      sessionId: "session-a",
    } as QuestmasterTask;
    const previousOwner = {
      ...makeQuest({ questId: "q-2", title: "Previous owner", status: "done" }),
      previousOwnerSessionIds: ["session-a"],
    } as QuestmasterTask;
    const otherOwner = {
      ...makeQuest({ questId: "q-3", title: "Other owner", status: "idea" }),
      sessionId: "session-b",
    } as QuestmasterTask;
    const app = makeApp([activeOwner, previousOwner, otherOwner]);

    const sessionRes = await app.request("/api/quests/_page?session=session-a&limit=10");
    expect(sessionRes.status).toBe(200);
    await expect(sessionRes.json()).resolves.toMatchObject({
      quests: [{ questId: "q-1" }, { questId: "q-2" }],
      total: 2,
    });

    const sessionIdRes = await app.request("/api/quests/_page?sessionId=session-a&limit=10");
    expect(sessionIdRes.status).toBe(200);
    await expect(sessionIdRes.json()).resolves.toMatchObject({
      quests: [{ questId: "q-1" }, { questId: "q-2" }],
      total: 2,
    });
  });
});

describe("GET /api/quests/_autocomplete", () => {
  it("returns minimal quest id/title candidates with validators", async () => {
    const app = makeApp([
      makeQuest({ questId: "q-1517", title: "Fix 1P NLL prefix", status: "in_progress", updatedAt: 100 }),
      makeQuest({ questId: "q-1513", title: "Build 300-example eval variants", status: "in_progress", updatedAt: 90 }),
    ]);

    const first = await app.request("/api/quests/_autocomplete");

    expect(first.status).toBe(200);
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();
    await expect(first.json()).resolves.toEqual([
      { questId: "q-1517", title: "Fix 1P NLL prefix" },
      { questId: "q-1513", title: "Build 300-example eval variants" },
    ]);

    const second = await app.request("/api/quests/_autocomplete", {
      headers: { "if-none-match": etag ?? "" },
    });

    expect(second.status).toBe(304);
  });
});

describe("GET /api/quests/_titles", () => {
  it("returns only requested canonical exact records in normalized first-seen order", async () => {
    // Retained leader tabs can outlive board/list membership, so hydration is by exact open ids with commit evidence and stale-id reporting.
    const q1 = {
      ...makeQuest({ questId: "q-1", title: "First canonical title", updatedAt: 20, description: "large body" }),
      version: 3,
      commitShas: ["abc1234"],
    } as QuestmasterTask;
    const q2 = {
      ...makeQuest({ questId: "q-2", title: "Second canonical title", createdAt: 2 }),
      version: 4,
      statusChangedAt: 15,
    } as QuestmasterTask;
    const q3 = makeQuest({ questId: "q-3", title: "Third canonical title", createdAt: 3 });
    const app = makeApp([q1, q2, q3]);

    const res = await app.request("/api/quests/_titles?ids=%20Q-2%20,q-1,q-2,invalid,q-404&ids=q-3");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      quests: [
        { questId: "q-2", title: "Second canonical title", version: 4, updatedAt: 15, commitShas: [] },
        { questId: "q-1", title: "First canonical title", version: 3, updatedAt: 20, commitShas: ["abc1234"] },
        { questId: "q-3", title: "Third canonical title", version: 1, updatedAt: 3, commitShas: [] },
      ],
      missingQuestIds: ["q-404"],
    });
  });

  it("rejects more than 100 distinct valid quest ids", async () => {
    // The endpoint is a bounded hydration surface, not another full-corpus Questmaster list path.
    const requestedIds = Array.from({ length: 101 }, (_, index) => `q-${index + 1}`).join(",");
    const app = makeApp([]);

    const res = await app.request(`/api/quests/_titles?ids=${requestedIds}`);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "At most 100 quest IDs may be requested" });
  });
});
