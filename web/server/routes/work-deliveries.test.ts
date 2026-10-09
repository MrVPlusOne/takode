import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerWorkDeliveryRoutes } from "./work-deliveries.js";
import * as store from "../quest-store.js";
import { buildCodeDelivery, runPortCommand } from "../quest-code-deliveries.js";
import { appendCodeEvidence } from "../quest-delivery-evidence.js";
import type { QuestmasterTask } from "../quest-types.js";
import { deliveryFixture, FIRST_DELIVERY_SHA } from "../../src/test-fixtures/commit-delivery-fixture.js";

vi.mock("../quest-store.js", () => ({ getQuest: vi.fn(), appendQuestCodeCommitEvidenceForOwner: vi.fn() }));
vi.mock("../quest-code-deliveries.js", () => ({ buildCodeDelivery: vi.fn(), runPortCommand: vi.fn() }));

let app: Hono;
let quest: QuestmasterTask;
let row: {
  questId: string;
  worker: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  waitForInput?: string[];
  journey: object;
};
let callerId: string;
let callerHostId: string | undefined;
let release = vi.fn(() => {});
let locked: boolean;
let broadcast: ReturnType<typeof vi.fn>;
const landingQueue = { attestsLanding: vi.fn(async () => false), attestsUnlanded: vi.fn(async () => false) };
const delivery = {
  ...deliveryFixture,
  commits: [deliveryFixture.commits[0]!],
  actorSessionId: "worker",
  phaseOccurrenceId: "board-leader-100:p4",
};

beforeEach(() => {
  vi.resetAllMocks();
  callerId = "worker";
  callerHostId = undefined;
  locked = false;
  release = vi.fn(() => {
    locked = false;
  });
  broadcast = vi.fn();
  row = {
    questId: "q-9904",
    worker: "worker",
    status: "WORKING",
    createdAt: 100,
    updatedAt: 101,
    journey: {
      phaseIds: ["alignment", "work", "user-checkpoint", "work", "memory"],
      activePhaseIndex: 3,
      currentPhaseId: "work",
    },
  };
  quest = {
    id: "q-9904",
    questId: "q-9904",
    version: 1,
    title: "Deliver changes",
    description: "Approved implementation",
    status: "in_progress",
    sessionId: "worker",
    createdAt: 1,
    claimedAt: 2,
    statusChangedAt: 2,
    feedback: [
      {
        author: "agent",
        authorSessionId: "worker",
        phaseId: "work",
        kind: "phase_summary",
        ts: 100,
        journeyRunId: "board-leader-100",
        phaseOccurrenceId: "board-leader-100:p4",
        text: "Current implementation is reviewed, verified, and synchronized to the selected delivery target; retained review evidence is ready.",
      },
    ],
  } as QuestmasterTask;
  vi.mocked(store.getQuest).mockImplementation(async () => quest);
  vi.mocked(buildCodeDelivery).mockResolvedValue(delivery);
  vi.mocked(store.appendQuestCodeCommitEvidenceForOwner).mockImplementation(async (_id, owner, shas, record) => {
    quest = appendCodeEvidence(quest, owner, shas as string[], record);
    return quest;
  });
  app = new Hono();
  registerWorkDeliveryRoutes(app, {
    launcher: {} as never,
    authenticateTakodeCaller: (() => ({
      callerId,
      caller: { sessionId: callerId, isOrchestrator: false, hostId: callerHostId },
    })) as never,
    wsBridge: {
      findAssignedBoardRowsForWorker: () => [{ leaderSessionId: "leader", row }],
      broadcastGlobal: broadcast,
      landingQueue,
    } as never,
    acquireWorkEvidenceMutationLock: () => {
      if (locked) return null;
      locked = true;
      return release;
    },
  });
});

function recordDelivery() {
  return app.request("/takode/board/record-work-delivery", {
    method: "POST",
    body: JSON.stringify({ questId: "q-9904", commitShas: [FIRST_DELIVERY_SHA], workFeedbackIndex: 0 }),
  });
}

describe("landing queue attestations on port tracking", () => {
  const SOURCE = "a".repeat(40);
  const TARGET = "b".repeat(40);
  const status = { id: delivery.id, state: "landed" as const, landed: [], remaining: [], nextAction: "Recorded" };

  it("passes a receipt the landing queue vouches for as attested, and refuses one it does not", async () => {
    // `takode land finish` names its entry; only the queue's own record can relax the blob check.
    vi.mocked(runPortCommand).mockResolvedValue(status);
    landingQueue.attestsLanding.mockResolvedValueOnce(true);
    const landed = (landingEntryId: string) =>
      app.request("/takode/port/q-9904/landed", {
        method: "POST",
        body: JSON.stringify({ id: delivery.id, workerSha: SOURCE, targetSha: TARGET, landingEntryId }),
      });
    expect((await landed("le-00000001")).status).toBe(200);
    expect(landingQueue.attestsLanding).toHaveBeenCalledWith("le-00000001", "worker", delivery.id, SOURCE, TARGET);
    expect(runPortCommand).toHaveBeenCalledWith(expect.anything(), {
      action: "landed",
      id: delivery.id,
      workerSha: SOURCE,
      targetSha: TARGET,
      attested: true,
    });
    vi.mocked(runPortCommand).mockClear();
    const refused = await landed("le-00000002");
    expect(refused.status).toBe(409);
    expect(runPortCommand).not.toHaveBeenCalled();
  });

  it("lets a re-prepare replace a preparation whose landing entry bounced", async () => {
    vi.mocked(runPortCommand).mockResolvedValue({ ...status, state: "retained" });
    landingQueue.attestsUnlanded.mockResolvedValueOnce(true);
    const response = await app.request("/takode/port/q-9904/prepare", {
      method: "POST",
      body: JSON.stringify({ baseSha: TARGET, confirmPrivate: true, previousId: delivery.id }),
    });
    expect(response.status).toBe(200);
    expect(runPortCommand).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "prepare", previousId: delivery.id, previousUnlanded: true }),
    );
  });
});

describe("guarded delivery recording before Memory", () => {
  it("allows read-only receipt inspection after Work while mutation remains gated", async () => {
    row.status = "MEMORY";
    vi.mocked(runPortCommand).mockResolvedValue({
      id: delivery.id,
      state: "landed",
      landed: [],
      remaining: [],
      nextAction: "Recorded",
    });
    expect((await app.request(`/takode/port/q-9904/${delivery.id}`)).status).toBe(200);
    expect(runPortCommand).toHaveBeenCalledWith(expect.objectContaining({ phaseOccurrenceId: "inspection" }), {
      action: "inspect",
      id: delivery.id,
    });
    expect((await recordDelivery()).status).toBe(409);
    expect(store.appendQuestCodeCommitEvidenceForOwner).not.toHaveBeenCalled();
  });

  it("runs a remote worker's port tracking on its host, never on this machine", async () => {
    // No host link is up, so the request fails; it must not fall back to this machine's Git.
    callerHostId = "devbox";
    const response = await app.request(`/takode/port/q-9904/${delivery.id}`);
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("devbox");
    expect(runPortCommand).not.toHaveBeenCalled();
  });

  it("records provenance and code SHAs together, remains in Work, and deduplicates a retry", async () => {
    expect((await recordDelivery()).status).toBe(200);
    expect((await recordDelivery()).status).toBe(200);
    expect(quest.commitShas).toEqual([FIRST_DELIVERY_SHA]);
    expect(quest.codeDeliveries).toHaveLength(1);
    expect(row.status).toBe("WORKING");
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: "quest_list_updated" }));
    expect(JSON.stringify(broadcast.mock.calls)).not.toContain("refs/takode");
    expect(release).toHaveBeenCalledTimes(2);
  });

  it.each([
    "owner",
    "checkpoint",
    "feedback",
    "old-note",
  ])("rejects %s failures before verifying or writing delivery", async (kind) => {
    // These are the same authority boundaries as Work -> Memory, including the later Work occurrence.
    if (kind === "owner") callerId = "other-worker";
    if (kind === "checkpoint") row.waitForInput = ["n-7"];
    if (kind === "feedback") quest.feedback!.push({ author: "human", text: "Pending refinement", ts: 102 });
    if (kind === "old-note") quest.feedback![0]!.phaseOccurrenceId = "board-leader-100:p2";
    expect((await recordDelivery()).status).toBeGreaterThanOrEqual(400);
    expect(buildCodeDelivery).not.toHaveBeenCalled();
    expect(store.appendQuestCodeCommitEvidenceForOwner).not.toHaveBeenCalled();
  });

  it("revalidates phase and owner after asynchronous Git verification", async () => {
    vi.mocked(buildCodeDelivery).mockImplementation(async () => {
      row.status = "USER_CHECKPOINTING";
      return delivery;
    });
    expect((await recordDelivery()).status).toBe(409);
    expect(store.appendQuestCodeCommitEvidenceForOwner).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });
});
