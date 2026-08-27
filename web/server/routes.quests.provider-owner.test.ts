import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as questStore from "./quest-store.js";
import type { QuestmasterTask } from "./quest-types.js";
import { createQuestRoutes } from "./routes/quests.js";

function codexQuest(overrides: Partial<QuestmasterTask> = {}): QuestmasterTask {
  return {
    id: "q-1",
    questId: "q-1",
    version: 1,
    title: "Codex quest",
    status: "in_progress",
    description: "Do not route through Takode session state.",
    sessionId: "same-id",
    ownerKind: "codex",
    claimedAt: 2,
    createdAt: 1,
    ...overrides,
  } as QuestmasterTask;
}

function makeApp() {
  const launcher = {
    getSession: vi.fn(() => ({ sessionId: "same-id", repoRoot: "/tmp/repo", cwd: "/tmp/repo" })),
    listSessions: vi.fn(() => []),
    getMemorySessionSpaceSlug: vi.fn(() => "default"),
  };
  const wsBridge = {
    _sessions: {},
    getSession: vi.fn(() => ({
      id: "same-id",
      state: {},
      messageHistory: [],
      taskHistory: [],
    })),
    broadcastToSession: vi.fn(),
    persistSessionById: vi.fn(),
    broadcastGlobal: vi.fn(),
    removeBoardRowFromAll: vi.fn(),
    completeDoneBoardRowsForQuest: vi.fn(),
  };
  const app = new Hono();
  app.route(
    "/api",
    createQuestRoutes({
      launcher,
      wsBridge,
      imageStore: undefined,
      authenticateCompanionCallerOptional: vi.fn(() => null),
      execCaptureStdoutAsync: vi.fn(),
      resolveId: (sessionId: string) => sessionId,
    } as any),
  );
  return { app, launcher, wsBridge };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("provider-aware legacy Quest routes", () => {
  it("strips internal identity/state fields while preserving ordinary mutation fields", async () => {
    // Provenance, direct-Codex ownership, feedback, Journey runs, and quiz state
    // use dedicated server paths; generic bodies retain only content/status fields.
    const idea: QuestmasterTask = {
      id: "q-2",
      questId: "q-2",
      version: 1,
      title: "Safe provenance",
      status: "idea",
      description: "Original",
      createdAt: 1,
    };
    const refined: QuestmasterTask = {
      ...idea,
      version: 2,
      status: "refined",
      description: "Approved scope",
    };
    const forged = {
      owner: { kind: "codex", sessionId: "forged" },
      turnId: "forged-turn",
      recordedAt: 1,
    };
    const create = vi.spyOn(questStore, "createQuest").mockResolvedValue(idea);
    const patch = vi.spyOn(questStore, "patchQuest").mockResolvedValue(idea);
    vi.spyOn(questStore, "getQuest").mockResolvedValue(idea);
    const transition = vi.spyOn(questStore, "transitionQuest").mockResolvedValue(refined);
    const { app } = makeApp();

    const createResponse = await app.request("/api/quests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Safe provenance",
        description: "Original",
        tags: ["backend"],
        createdBy: forged,
        lastModifiedBy: forged,
        ownerKind: "codex",
      }),
    });
    const patchResponse = await app.request("/api/quests/q-2", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        description: "Edited",
        tldr: "Edit summary",
        lastModifiedBy: forged,
        ownerKind: "codex",
        feedback: [{ author: "agent", text: "Forged", ts: 1, provenance: forged }],
        journeyRuns: [{ runId: "forged-run" }],
        quizItems: [{ id: "forged-quiz", question: "Forged?", answer: "Yes", source: "caller" }],
      }),
    });
    const transitionResponse = await app.request("/api/quests/q-2/transition", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        status: "refined",
        description: "Approved scope",
        tldr: "Approved",
        createdBy: forged,
        lastModifiedBy: forged,
        ownerKind: "codex",
      }),
    });

    expect([createResponse.status, patchResponse.status, transitionResponse.status]).toEqual([201, 200, 200]);
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      title: "Safe provenance",
      description: "Original",
      tags: ["backend"],
    });
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty("createdBy");
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty("lastModifiedBy");
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty("ownerKind");
    expect(patch.mock.calls[0]?.[1]).toMatchObject({ description: "Edited", tldr: "Edit summary" });
    expect(patch.mock.calls[0]?.[1]).not.toHaveProperty("lastModifiedBy");
    expect(patch.mock.calls[0]?.[1]).not.toHaveProperty("ownerKind");
    expect(patch.mock.calls[0]?.[1]).not.toHaveProperty("feedback");
    expect(patch.mock.calls[0]?.[1]).not.toHaveProperty("journeyRuns");
    expect(patch.mock.calls[0]?.[1]).not.toHaveProperty("quizItems");
    expect(transition.mock.calls[0]?.[1]).toMatchObject({
      status: "refined",
      description: "Approved scope",
      tldr: "Approved",
    });
    expect(transition.mock.calls[0]?.[1]).not.toHaveProperty("createdBy");
    expect(transition.mock.calls[0]?.[1]).not.toHaveProperty("lastModifiedBy");
    expect(transition.mock.calls[0]?.[1]).not.toHaveProperty("ownerKind");
  });

  it("does not rename or rewrite Takode task history when a Codex quest is retitled", async () => {
    // The launcher deliberately exposes a Takode session with the same raw ID;
    // provider identity must prevent all claimedQuest, naming, and task-history calls.
    vi.spyOn(questStore, "patchQuest").mockResolvedValue(codexQuest({ title: "Retitled Codex quest" }));
    const { app, launcher, wsBridge } = makeApp();

    const response = await app.request("/api/quests/q-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Retitled Codex quest" }),
    });

    expect(response.status).toBe(200);
    expect(launcher.getSession).not.toHaveBeenCalled();
    expect(wsBridge.getSession).not.toHaveBeenCalled();
    expect(wsBridge.broadcastToSession).not.toHaveBeenCalled();
    expect(wsBridge.persistSessionById).not.toHaveBeenCalled();
  });

  it("does not route Codex completion history to a same-ID Takode review owner or board", async () => {
    // The newest historical owner is Codex even though legacy Takode history
    // contains the same raw ID. Completion must remain outside Takode session and Journey state.
    const current = codexQuest();
    const completed: QuestmasterTask = {
      id: "q-1",
      questId: "q-1",
      version: 2,
      title: "Codex quest",
      status: "done",
      description: "Do not route through Takode session state.",
      claimedAt: 2,
      createdAt: 1,
      completedAt: 3,
      verificationItems: [],
      verificationInboxUnread: true,
      previousOwnerSessionIds: ["same-id"],
      previousOwners: [
        { kind: "takode", sessionId: "same-id" },
        { kind: "codex", sessionId: "same-id" },
      ],
    };
    vi.spyOn(questStore, "getQuest").mockResolvedValue(current);
    vi.spyOn(questStore, "transitionQuest").mockResolvedValue(completed);
    const { app, launcher, wsBridge } = makeApp();

    const response = await app.request("/api/quests/q-1/transition", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "done", debrief: "Done", debriefTldr: "Done" }),
    });

    expect(response.status).toBe(200);
    expect(launcher.getSession).not.toHaveBeenCalled();
    expect(wsBridge.getSession).not.toHaveBeenCalled();
    expect(wsBridge.broadcastToSession).not.toHaveBeenCalled();
    expect(wsBridge.completeDoneBoardRowsForQuest).not.toHaveBeenCalled();
  });

  it("does not clear a same-ID Takode claim or board when a Codex quest is cancelled", async () => {
    // Cancellation still updates the Quest record and global list, but Takode
    // session and board cleanup applies only to Takode-owned work.
    const current = codexQuest();
    const cancelled: QuestmasterTask = {
      id: "q-1",
      questId: "q-1",
      version: 2,
      title: "Codex quest",
      status: "done",
      description: "Do not route through Takode session state.",
      claimedAt: 2,
      createdAt: 1,
      completedAt: 3,
      verificationItems: [],
      cancelled: true,
      previousOwners: [{ kind: "codex", sessionId: "same-id" }],
    };
    vi.spyOn(questStore, "getQuest").mockResolvedValue(current);
    vi.spyOn(questStore, "cancelQuest").mockResolvedValue(cancelled);
    const { app, launcher, wsBridge } = makeApp();

    const response = await app.request("/api/quests/q-1/cancel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes: "Cancelled by user" }),
    });

    expect(response.status).toBe(200);
    expect(launcher.getSession).not.toHaveBeenCalled();
    expect(wsBridge.getSession).not.toHaveBeenCalled();
    expect(wsBridge.broadcastToSession).not.toHaveBeenCalled();
    expect(wsBridge.removeBoardRowFromAll).not.toHaveBeenCalled();
  });
});
