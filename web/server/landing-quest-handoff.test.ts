import { describe, expect, it, vi } from "vitest";
import { LandingQuestHandoff, type LandingQuestHandoffDeps } from "./landing-quest-handoff.js";
import type { LandingEntry } from "../shared/landing-queue.js";
import type { BoardRow, ParkedQuestCompletion } from "./session-types.js";

const sha = (n: number) => n.toString(16).padStart(40, "0");

/**
 * The hand-off's own decisions, against an in-memory board: retries of a
 * landing whose commits could not be recorded, outcomes that arrive before the
 * quest was handed to Memory, and a bounce reported while the worker is still
 * in Memory. The real-route path is covered by routes/landing-handoff.test.ts.
 */
function harness(status: "MEMORY" | "LANDING" = "MEMORY") {
  const rows = new Map<string, BoardRow>([
    [
      "q-1",
      {
        questId: "q-1",
        worker: "worker",
        status,
        createdAt: 1,
        updatedAt: 1,
        journey: {
          phaseIds: ["work", "memory", "landing"],
          activePhaseIndex: status === "MEMORY" ? 1 : 2,
          currentPhaseId: status === "MEMORY" ? "memory" : "landing",
        },
        landing: {
          entryId: "le-00000001",
          workerSessionId: "worker",
          workPhaseOccurrenceId: "run:p1",
          branch: "main",
          tip: sha(101),
        },
      },
    ],
  ]);
  let entry: LandingEntry = {
    id: "le-00000001",
    key: "repo:main",
    target: { repo: "repo", branch: "main" },
    sessionId: "worker",
    questId: "q-1",
    bundleId: "b-00000001",
    base: sha(1),
    tip: sha(101),
    commits: [{ sha: sha(101), subject: "change" }],
    preSubmitTest: { kind: "skipped", reason: "test" },
    submittedAt: 1,
    state: "pending",
  };
  const messages: { session: string; text: string }[] = [];
  const recordDelivery = vi.fn<LandingQuestHandoffDeps["recordDelivery"]>(async () => ({ deliveryId: "d-1" }));
  const completeQuest = vi.fn<LandingQuestHandoffDeps["completeQuest"]>(async () => {
    rows.delete("q-1");
  });
  const handoff = new LandingQuestHandoff({
    activeRows: () => [...rows.values()].map((row) => ({ leaderSessionId: "leader", row })),
    updateRow: (_leader, patch) => {
      const existing = rows.get(patch.questId)!;
      rows.set(patch.questId, { ...existing, ...patch } as BoardRow);
    },
    getEntry: async () => entry,
    recordDelivery,
    completeQuest,
    notify: (session, text) => void messages.push({ session, text }),
  });
  return {
    handoff,
    rows,
    messages,
    recordDelivery,
    completeQuest,
    row: () => rows.get("q-1"),
    setEntry: (patch: Partial<LandingEntry>) => {
      entry = { ...entry, ...patch };
      return entry;
    },
  };
}

const completion: ParkedQuestCompletion = {
  verificationItems: [],
  debrief: "Done.",
  debriefTldr: "Done.",
  completedAt: 1,
};
const landed = { state: "landed" as const, mapping: [{ source: sha(101), target: sha(201), subject: "change" }] };

describe("landing quest hand-off", () => {
  it("retries recording a landed change that failed, telling the leader once, and then completes the quest", async () => {
    const h = harness("LANDING");
    h.row()!.landing!.completion = completion;
    h.recordDelivery.mockRejectedValueOnce(new Error("the host is offline"));
    h.recordDelivery.mockRejectedValueOnce(new Error("the host is offline"));

    expect(await h.handoff.entryResolved(h.setEntry({ ...landed, pushedTip: sha(201) }))).toBe(true);
    expect(h.row()!.landing).toMatchObject({ outcome: "landed", recordError: expect.stringContaining("offline") });
    await h.handoff.retryPending();
    // Still failing: the leader was told the first time only.
    expect(h.messages.filter((message) => message.session === "leader")).toHaveLength(1);
    expect(h.completeQuest).not.toHaveBeenCalled();

    await h.handoff.retryPending();
    expect(h.recordDelivery).toHaveBeenCalledTimes(3);
    expect(h.recordDelivery.mock.calls[2]![0]).toMatchObject({
      questId: "q-1",
      workerSessionId: "worker",
      workPhaseOccurrenceId: "run:p1",
      tip: sha(201),
      mapping: landed.mapping,
    });
    expect(h.completeQuest).toHaveBeenCalledWith("q-1", completion, "worker");
    expect(h.messages.at(-1)!.text).toContain("Delivery d-1: `quest commit-links q-1 --delivery d-1`");
  });

  it("tells the owner how to hand off a change that landed before its quest went to Memory", async () => {
    const h = harness();
    h.rows.get("q-1")!.landing = undefined;
    expect(await h.handoff.entryResolved(h.setEntry(landed))).toBe(true);
    expect(h.messages).toEqual([
      expect.objectContaining({
        session: "worker",
        text: expect.stringContaining(
          "takode board work-to-memory q-1 --work-note <index> --landing-entry le-00000001",
        ),
      }),
    ]);
    // A bounce before the hand-off is the queue's own message to the owner, still in Work.
    expect(await h.handoff.entryResolved(h.setEntry({ state: "bounced", reason: "conflict" }))).toBe(false);
  });

  it("lets a worker in Memory finish, then routes a change that bounced meanwhile to the leader", async () => {
    const h = harness();
    expect(await h.handoff.entryResolved(h.setEntry({ state: "bounced", reason: "conflict", details: "boom" }))).toBe(
      true,
    );
    expect(h.messages.map((message) => message.session)).toEqual(["worker"]);
    expect(h.messages[0]!.text).toContain("Finish Memory as usual");
    // A repeated report of the same outcome changes nothing.
    expect(await h.handoff.entryResolved(h.setEntry({ state: "bounced" }))).toBe(true);
    expect(h.messages).toHaveLength(1);

    expect(h.handoff.park("q-1", completion)).toMatchObject({ outcome: "bounced" });
    await vi.waitFor(() => expect(h.messages.map((message) => message.session)).toEqual(["worker", "leader"]));
    expect(h.row()).toMatchObject({ status: "LANDING" });
    expect(h.row()!.journey!.phaseIds).toEqual(["work", "memory", "landing", "work", "memory"]);
    expect(h.recordDelivery).not.toHaveBeenCalled();
  });
});
