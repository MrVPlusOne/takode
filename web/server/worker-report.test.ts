import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { BoardRow } from "./session-types.js";
import type { RouteContext } from "./routes/context.js";

const testHome = vi.hoisted(() => ({ path: "" }));
vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:os")>()),
  homedir: () => testHome.path,
}));

let store: typeof import("./quest-store.js");
let publish: typeof import("./worker-report.js").publishWorkerReport;
let row: BoardRow;
let worker: { herdedBy: string; isOrchestrator?: boolean };
let session: { isGenerating: boolean; activeTurnRoute: { questId?: string; threadKey?: string } };
let ctx: Pick<RouteContext, "launcher" | "wsBridge">;
const emit = vi.fn(() => true);

beforeEach(async () => {
  // Every write, backup and cleanup is under this proven disposable home.
  testHome.path = mkdtempSync(join(tmpdir(), "worker-report-store-"));
  vi.resetModules();
  store = await import("./quest-store.js");
  publish = (await import("./worker-report.js")).publishWorkerReport;
  await store.createQuest({
    title: "Optional report",
    description: "Record an optional worker report",
    status: "refined",
  });
  await store.claimQuest("q-1", "worker-1", { leaderSessionId: "leader-1" });
  row = {
    questId: "q-1",
    worker: "worker-1",
    status: "WORKING",
    createdAt: 100,
    updatedAt: 100,
    journey: { phaseIds: ["work", "memory"], activePhaseIndex: 0, currentPhaseId: "work" },
  };
  worker = { herdedBy: "leader-1" };
  session = { isGenerating: true, activeTurnRoute: { questId: "q-1" } };
  emit.mockReset().mockReturnValue(true);
  ctx = {
    launcher: { getSession: () => worker },
    wsBridge: {
      getSession: (id: string) => (id === "worker-1" ? session : { board: new Map([[row.questId, row]]) }),
      emitWorkerReportCheckpoint: emit,
      broadcastGlobal: vi.fn(),
    },
  } as unknown as Pick<RouteContext, "launcher" | "wsBridge">;
});
afterEach(() => rmSync(testHome.path, { recursive: true, force: true }));

describe("authored worker reports", () => {
  it("routes authenticated report text through the real HTTP handler and store", async () => {
    // Exercise the newly selected route branch, not only the service or a fake CLI server.
    const { createTakodeRoutes } = await import("./routes/takode.js");
    const app = new Hono();
    app.route(
      "/api",
      createTakodeRoutes({
        ...ctx,
        authenticateTakodeCaller: () => ({ callerId: "worker-1", caller: worker }),
        resolveId: (id: string) => id,
      } as unknown as RouteContext),
    );
    const text = "  complete report\n";
    const response = await app.request("/api/sessions/worker-1/worker-stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ recorded: true, queued: true, feedbackIndex: 0 });
    expect((await store.getQuest("q-1"))?.feedback?.[0].text).toBe(text);
  });

  it("preserves literal content and records exact Work provenance without completing or pausing", async () => {
    const text = "  A literal [thread:main:C] example\n```sh\n$(do-not-run)\n```\n";
    const originalRow = structuredClone(row);
    const result = await publish(ctx, "worker-1", text);
    const quest = await store.getQuest("q-1");
    expect(quest?.feedback?.[result.feedbackIndex]).toMatchObject({
      text,
      author: "agent",
      authorSessionId: "worker-1",
      kind: "phase_finding",
      phaseId: "work",
      phasePosition: 1,
      journeyRunId: "board-leader-1-100",
      phaseOccurrenceId: "board-leader-1-100:p1",
    });
    expect(quest?.journeyRuns?.[0].phaseOccurrences[0].phaseId).toBe("work");
    expect(quest?.status).toBe("in_progress");
    expect(row).toEqual(originalRow);
    expect(result).toMatchObject({ recorded: true, queued: true, reused: false });
    expect(emit).toHaveBeenCalledWith(
      "worker-1",
      "q-1",
      expect.objectContaining({ feedbackIndex: 0, phasePosition: 1 }),
    );
    const { resolveCurrentWorkFeedback } = await import("./routes/work-evidence-context.js");
    expect(
      resolveCurrentWorkFeedback({
        quest: quest!,
        authorSessionId: "worker-1",
        requestedIndex: result.feedbackIndex,
        activeScope: { journeyRunId: "board-leader-1-100", phaseOccurrenceId: "board-leader-1-100:p1" },
      }),
    ).toHaveProperty("error");
  });

  it("deduplicates concurrent retries while preserving different concurrent reports", async () => {
    // The actual store lock, not a mocked array append, provides this race guarantee.
    const results = await Promise.all([
      publish(ctx, "worker-1", "same"),
      publish(ctx, "worker-1", "same"),
      publish(ctx, "worker-1", "different"),
    ]);
    expect(results[0].reportId).toBe(results[1].reportId);
    expect((await store.getQuest("q-1"))?.feedback?.map((entry) => entry.text).sort()).toEqual(["different", "same"]);
    const before = await store.getQuest("q-1");
    await publish(ctx, "worker-1", "same");
    expect(await store.getQuest("q-1")).toEqual(before);
  });

  it("keeps identical reports distinct across quests created in the same millisecond", async () => {
    // Board-backed occurrence IDs are scoped to a quest; timestamps alone are not globally unique.
    const first = await publish(ctx, "worker-1", "same material finding");
    await store.completeQuest("q-1", []);
    await store.createQuest({ title: "Next report", description: "Same timestamp, another quest", status: "refined" });
    await store.claimQuest("q-2", "worker-1", { leaderSessionId: "leader-1" });
    row.questId = "q-2";
    session.activeTurnRoute.questId = "q-2";
    const next = await publish(ctx, "worker-1", "same material finding");
    expect(next.reportId).not.toBe(first.reportId);
    expect(next).toMatchObject({ recorded: true, queued: true, questId: "q-2" });
  });

  it.each([
    "route",
    "main-route",
    "assignment",
    "phase",
    "generation",
    "leader",
    "role",
  ])("rejects invalid %s authority before writing", async (boundary) => {
    if (boundary === "route") session.activeTurnRoute.questId = "q-2";
    if (boundary === "main-route") session.activeTurnRoute = { threadKey: "main" };
    if (boundary === "assignment") row.worker = "other-worker";
    if (boundary === "phase") row.status = "USER_CHECKPOINTING";
    if (boundary === "generation") session.isGenerating = false;
    if (boundary === "leader") worker.herdedBy = "other-leader";
    if (boundary === "role") worker.isOrchestrator = true;
    await expect(publish(ctx, "worker-1", "report")).rejects.toThrow();
    expect((await store.getQuest("q-1"))?.feedback ?? []).toHaveLength(0);
    expect(emit).not.toHaveBeenCalled();
  });

  it("keeps a recorded report inspectable when notification cannot be queued", async () => {
    emit.mockReturnValue(false);
    const result = await publish(ctx, "worker-1", "saved evidence");
    expect(result).toMatchObject({ recorded: true, queued: false });
    expect((await store.getQuest("q-1"))?.feedback?.[0].text).toBe("saved evidence");
  });

  it("rechecks the assignment inside the store lock before recording", async () => {
    // Deterministically move the boundary after request preflight and before the atomic callback.
    const patch = store.patchQuestForOwner;
    const spy = vi.spyOn(store, "patchQuestForOwner").mockImplementation((...args) => {
      row.createdAt = 200;
      return patch(...args);
    });
    try {
      await expect(publish(ctx, "worker-1", "old occurrence")).rejects.toThrow("assignment changed");
      expect((await store.getQuest("q-1"))?.feedback ?? []).toHaveLength(0);
      expect(emit).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("retains the old source without notifying a replacement assignment after recording", async () => {
    const patch = store.patchQuestForOwner;
    const spy = vi.spyOn(store, "patchQuestForOwner").mockImplementation(async (...args) => {
      const result = await patch(...args);
      row.worker = "replacement-worker";
      return result;
    });
    try {
      expect(await publish(ctx, "worker-1", "recorded before reassignment")).toMatchObject({
        recorded: true,
        queued: false,
      });
      expect((await store.getQuest("q-1"))?.feedback?.[0].authorSessionId).toBe("worker-1");
      expect(emit).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
