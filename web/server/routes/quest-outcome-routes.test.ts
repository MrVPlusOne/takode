import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QuestInProgress } from "../quest-types.js";
import type { RouteContext } from "./context.js";

const store = vi.hoisted(() => ({
  getQuest: vi.fn(),
}));

vi.mock("../quest-store.js", () => store);

import { createQuestOutcomeRoutes } from "./quest-outcome-routes.js";

function quest(outcome?: unknown): QuestInProgress {
  return {
    id: "q-42",
    questId: "q-42",
    version: 2,
    title: "Legacy outcome recovery",
    description: "Test",
    status: "in_progress",
    sessionId: "worker",
    claimedAt: 1,
    createdAt: 1,
    ...(arguments.length > 0 ? { outcome } : {}),
  };
}

function app() {
  const api = new Hono();
  api.route("/api", createQuestOutcomeRoutes({} as RouteContext));
  return api;
}

describe("legacy Quest Outcome routes", () => {
  beforeEach(() => {
    store.getQuest.mockReset();
  });

  it("returns an opaque legacy payload unchanged for recovery inspection", async () => {
    const outcome = {
      futureVersion: 9,
      nested: { author: "human", raw: ["keep", { unknown: true }] },
      currentRevisionId: "not-authority",
    };
    store.getQuest.mockResolvedValue(quest(outcome));

    const response = await app().request("/api/quests/q-42/outcome");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ questId: "q-42", legacy: true, present: true, outcome });
  });

  it("returns null when no legacy field exists", async () => {
    store.getQuest.mockResolvedValue(quest());

    const response = await app().request("/api/quests/q-42/outcome");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ questId: "q-42", legacy: true, present: false, outcome: null });
  });

  it("preserves an explicitly stored null payload rather than inventing state", async () => {
    store.getQuest.mockResolvedValue(quest(null));

    const response = await app().request("/api/quests/q-42/outcome");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ questId: "q-42", legacy: true, present: true, outcome: null });
  });

  it("keeps missing-quest recovery inspection explicit", async () => {
    store.getQuest.mockResolvedValue(null);

    const response = await app().request("/api/quests/q-404/outcome");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Quest not found" });
  });
});
