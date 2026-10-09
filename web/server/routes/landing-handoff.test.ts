import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardRow, ParkedQuestCompletion } from "../session-types.js";
import type { LandingRunnerRequest } from "../landing-queue-manager.js";
import type { LandingTarget } from "../../shared/landing-queue.js";

const home = vi.hoisted(() => ({ path: "" }));
vi.mock("node:os", async (original) => ({ ...(await original<typeof import("node:os")>()), homedir: () => home.path }));
// Real git commands run through the guarded routes; under concurrent suite load they can be slow.
vi.setConfig({ testTimeout: 30_000 });

/**
 * The quest side of the landing queue through the real board routes, quest
 * store, landing queue and Git: a worker hands its submitted change to Memory
 * (`work-to-memory --landing-entry`), final Memory parks the quest in Landing,
 * and the change's outcome completes the quest or sends it back for a fix.
 * The runner process is played through the queue's runner calls; everything
 * durable lives in a disposable HOME.
 */
describe("landing hand-off through the real board routes", () => {
  let root: string;
  let origin: string;
  let base: string;
  let worker: string;
  let baseSha: string;
  let workerSha: string;
  let questId: string;
  let row: BoardRow;
  let caller: string;
  let app: Hono;
  let store: typeof import("../quest-store.js");
  let queue: import("../landing-queue-manager.js").LandingQueueManager;
  let launches: LandingRunnerRequest[];
  let messages: { session: string; text: string }[];
  let completed: { questId: string; completion: ParkedQuestCompletion; workerSessionId: string }[];
  let bridge: Record<string, any>;
  const target: LandingTarget = { repo: "origin", branch: "integration" };

  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const settle = async () => {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  };

  beforeEach(async () => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "landing-handoff-test-")));
    home.path = root;
    origin = join(root, "origin.git");
    base = join(root, "base");
    worker = join(root, "worker");
    git(root, "init", "--quiet", "--bare", "-b", "integration", origin);
    git(root, "clone", "--quiet", origin, base);
    for (const [key, value] of [
      ["user.email", "fixture@example.test"],
      ["user.name", "Fixture"],
    ])
      git(base, "config", key, value);
    writeFileSync(join(base, "seed.txt"), "seed\n");
    git(base, "add", ".");
    git(base, "commit", "--quiet", "-m", "seed");
    git(base, "push", "--quiet", "origin", "integration");
    baseSha = git(base, "rev-parse", "HEAD");
    git(base, "worktree", "add", "--quiet", "-b", "worker", worker, "origin/integration");
    writeFileSync(join(worker, "change.txt"), "change\n");
    git(worker, "add", ".");
    git(worker, "commit", "--quiet", "-m", "the change");
    workerSha = git(worker, "rev-parse", "HEAD");

    vi.resetModules();
    store = await import("../quest-store.js");
    const quest = await store.createQuest({ title: "Landing hand-off", status: "refined", description: "Change" });
    questId = quest.questId;
    await store.claimQuest(questId, "worker");
    await store.appendQuestFeedback(questId, {
      author: "agent",
      authorSessionId: "worker",
      phaseId: "work",
      kind: "phase_summary",
      ts: 100,
      journeyRunId: "board-leader-100",
      phaseOccurrenceId: "board-leader-100:p1",
      text: "The change is implemented, tested and submitted to the landing queue; this note owns the current Work evidence.",
    });
    row = {
      questId,
      worker: "worker",
      status: "WORKING",
      createdAt: 100,
      updatedAt: 100,
      journey: { phaseIds: ["work", "memory"], activePhaseIndex: 0, currentPhaseId: "work" },
    };
    caller = "worker";
    launches = [];
    messages = [];
    completed = [];

    const { LandingQueueManager } = await import("../landing-queue-manager.js");
    const { LandingQueueStore } = await import("../landing-queue-store.js");
    const { LandingGateStore } = await import("../landing-gate-store.js");
    const { ResourceLeaseManager } = await import("../resource-lease-manager.js");
    const { ResourceLeaseStore } = await import("../resource-lease-store.js");
    const leases = new ResourceLeaseManager(
      { injectUserMessage: () => "sent", invalidateSessionNavigation: () => undefined },
      new ResourceLeaseStore("test", join(root, "leases")),
    );
    queue = new LandingQueueManager(
      {
        leases,
        notify: (session, text) => void messages.push({ session, text }),
        launchRunner: async (request) => void launches.push(request),
        onEntryResolved: (entry) => bridge.landingHandoff.entryResolved(entry),
      },
      new LandingQueueStore("test", join(root, "queue")),
      new LandingGateStore("test", join(root, "gates")),
    );
    await queue.start();
    await queue.gates.set(target, { version: 1, steps: [{ name: "check", run: ["true"] }] }, {});

    const session = {
      id: "leader",
      state: {},
      board: new Map([[questId, row]]),
      completedBoard: new Map(),
      notifications: [],
      boardDispatchStates: new Map(),
      boardStallStates: new Map(),
      attentionRecords: [],
    };
    const workerTarget = {
      isWorktree: true,
      cwd: worker,
      actualBranch: "worker",
      worktreePortTarget: { repoRoot: base, branch: "integration" },
    };
    bridge = {
      getSession: (id: string) => (id === "leader" ? session : null),
      findAssignedBoardRowsForWorker: (workerId: string) =>
        workerId === row.worker && session.board.has(questId) ? [{ leaderSessionId: "leader", row }] : [],
      broadcastGlobal: () => undefined,
      landingQueue: queue,
      injectUserMessage: (sessionId: string, text: string) => void messages.push({ session: sessionId, text }),
      // Stands in for the quest routes' completion step, which these tests do not mount.
      completeLandedQuest: async (id: string, completion: ParkedQuestCompletion, workerSessionId: string) => {
        completed.push({ questId: id, completion, workerSessionId });
        await store.completeQuest(id, completion.verificationItems, {
          sessionId: workerSessionId,
          debrief: completion.debrief,
          debriefTldr: completion.debriefTldr,
        });
        session.board.delete(id);
      },
    };
    const { registerTakodeBoardRoutes } = await import("./takode-board.js");
    app = new Hono();
    registerTakodeBoardRoutes(app, {
      launcher: {
        getSession: (id: string) => (id === "worker" ? workerTarget : undefined),
        listSessions: () => [{ sessionId: "leader" }, { sessionId: "worker" }],
      } as never,
      wsBridge: bridge as never,
      authenticateTakodeCaller: (() => ({
        callerId: caller,
        caller: {
          sessionId: caller,
          isOrchestrator: caller === "leader",
          ...(caller === "worker" ? workerTarget : {}),
        },
      })) as never,
      resolveId: (id: string) => id,
      boardWatchdogDeps: {
        getSession: () => session,
        getLauncherSessionInfo: () => undefined,
        listSessions: () => [],
        resolveSessionId: () => undefined,
        timerCount: () => 0,
        backendConnected: () => true,
        getBoard: () => [...session.board.values()],
        emitTakodeEvent: () => {},
        markNotificationDone: () => true,
        isSessionIdle: () => true,
      } as never,
      workBoardStateDeps: {
        getBoardDispatchableSignature: () => null,
        markNotificationDone: () => true,
        broadcastBoard: () => {
          row = session.board.get(questId) ?? row;
        },
        broadcastAttentionRecords: () => {},
        persistSession: () => {},
        notifyReview: () => {},
      } as never,
      buildBoardRowSessionStatuses: async () => ({}),
      resolveSessionDeps: () => [],
    });
  });

  afterEach(async () => {
    await settle();
    queue.destroy();
    rmSync(root, { recursive: true, force: true });
  });

  const submit = async () =>
    (
      await queue.submit({
        callerSessionId: "worker",
        target,
        baseCheckout: base,
        questId,
        bundleId: "b-00000001",
        base: baseSha,
        tip: workerSha,
        commits: [{ sha: workerSha, subject: "the change" }],
        preSubmitTest: { kind: "skipped", reason: "fixture" },
      })
    ).entry;
  const workToMemory = (landingEntryId: string) =>
    app.request("/takode/board/work-to-memory", {
      method: "POST",
      body: JSON.stringify({ questId, workFeedbackIndex: 0, landingEntryId }),
    });
  const advance = () => {
    caller = "leader";
    return app.request(`/sessions/leader/board/${questId}/advance`, { method: "POST", body: "{}" });
  };
  const completion: ParkedQuestCompletion = {
    verificationItems: [],
    debrief: "The change is delivered.",
    debriefTldr: "Delivered the change.",
    completedAt: 1,
  };
  /** Play the runner the queue started: claim every waiting change and report one outcome for each. */
  async function runQueue(outcome: "landed" | "bounced") {
    await settle();
    const request = launches.at(-1)!;
    const runner = queue.verifyRunner(request.sessionId, request.token)!;
    const claim = await queue.claim(runner, target);
    if (outcome === "landed") git(worker, "push", "--quiet", "origin", `${workerSha}:refs/heads/integration`);
    await queue.finish(claim.run!.id, runner, {
      outcomes: claim.entries.map((entry) =>
        outcome === "landed"
          ? {
              entryId: entry.id,
              outcome: "landed" as const,
              mapping: [{ source: workerSha, target: workerSha, subject: "the change" }],
            }
          : {
              entryId: entry.id,
              outcome: "bounced" as const,
              reason: "It conflicts with the branch.",
              details: "boom",
            },
      ),
      ...(outcome === "landed" ? { pushedTip: workerSha } : {}),
      summary: "done",
    });
  }

  it("hands the quest to Memory, parks it in Landing and completes it when its change lands", async () => {
    const entry = await submit();
    const handed = await workToMemory(entry.id);
    expect(handed.status, await handed.clone().text()).toBe(200);
    // Takode adds Landing after Memory; the worker is not left waiting in Work.
    expect(row.status).toBe("MEMORY");
    expect(row.journey!.phaseIds).toEqual(["work", "memory", "landing"]);
    expect(row.landing).toMatchObject({ entryId: entry.id, workerSessionId: "worker", tip: workerSha });

    expect(bridge.landingHandoff.park(questId, completion)).toMatchObject({ entryId: entry.id, outcome: "waiting" });
    expect(row.status).toBe("LANDING");
    // While it waits, the leader cannot move it on by hand.
    const early = await advance();
    expect(early.status).toBe(409);
    expect(await early.json()).toMatchObject({ error: expect.stringContaining("waits for its change to land") });

    await runQueue("landed");
    await vi.waitFor(() => expect(completed).toHaveLength(1), { timeout: 15_000 });
    expect(completed[0]).toMatchObject({ questId, completion, workerSessionId: "worker" });
    const quest = await store.getQuest(questId);
    expect(quest!.commitShas).toEqual([workerSha]);
    expect(quest!.codeDeliveries).toHaveLength(1);
    expect(quest!.status).toBe("done");
    // The base checkout was fast-forwarded to the landed commit, as `land finish` used to.
    expect(git(base, "rev-parse", "HEAD")).toBe(workerSha);
    const leaderMessage = messages.find((message) => message.session === "leader")!.text;
    expect(leaderMessage).toContain(`${questId} landed on integration and Takode completed it`);
    expect(leaderMessage).toContain(`quest commit-links ${questId} --delivery ${quest!.codeDeliveries![0]!.id}`);
    // The worker had moved on: it is not told anything.
    expect(messages.filter((message) => message.session === "worker")).toEqual([]);
  });

  it("records a change that lands during Memory, so Memory then completes normally", async () => {
    const entry = await submit();
    expect((await workToMemory(entry.id)).status).toBe(200);
    await runQueue("landed");
    await vi.waitFor(async () => expect((await store.getQuest(questId))!.commitShas).toEqual([workerSha]), {
      timeout: 15_000,
    });
    expect(row.landing).toMatchObject({ outcome: "landed", deliveryId: expect.any(String) });
    expect(messages.find((message) => message.session === "worker")!.text).toContain("landed on integration");
    // Nothing waits any more, so final Memory completes the quest itself.
    expect(bridge.landingHandoff.park(questId, completion)).toBeNull();
    expect(row.status).toBe("MEMORY");
  });

  it("keeps a bounced change's quest in Landing for the leader, who starts the fix's Work occurrence", async () => {
    const entry = await submit();
    expect((await workToMemory(entry.id)).status).toBe(200);
    bridge.landingHandoff.park(questId, completion);
    await runQueue("bounced");
    await vi.waitFor(() => expect(messages.some((message) => message.session === "leader")).toBe(true));
    const leaderMessage = messages.find((message) => message.session === "leader")!.text;
    expect(leaderMessage).toContain("bounced and did not land. Reason: It conflicts with the branch.");
    expect(leaderMessage).toContain(`takode land resume ${entry.id}`);
    expect(row.status).toBe("LANDING");
    expect(row.landing).toMatchObject({ outcome: "bounced" });
    expect(row.journey!.phaseIds).toEqual(["work", "memory", "landing", "work", "memory"]);
    expect(completed).toEqual([]);

    // The leader decides when the fix starts; advancing opens the next Work occurrence.
    const advanced = await advance();
    expect(advanced.status, await advanced.clone().text()).toBe(200);
    expect(row.status).toBe("WORKING");
    expect(row.journey!.activePhaseIndex).toBe(3);
    expect(row.landing).toBeUndefined();
  });

  it("refuses to hand off an entry of another quest or a bounced change", async () => {
    const entry = await submit();
    await runQueue("bounced");
    await settle();
    const bounced = await workToMemory(entry.id);
    expect(bounced.status).toBe(409);
    expect(await bounced.json()).toMatchObject({ error: expect.stringContaining("bounced") });

    const other = await queue.submit({
      callerSessionId: "worker",
      target,
      baseCheckout: base,
      questId: "q-999999",
      bundleId: "b-00000002",
      base: baseSha,
      tip: workerSha,
      commits: [{ sha: workerSha, subject: "the change" }],
      preSubmitTest: { kind: "skipped", reason: "fixture" },
    });
    const wrongQuest = await workToMemory(other.entry.id);
    expect(wrongQuest.status).toBe(409);
    expect(await wrongQuest.json()).toMatchObject({ error: expect.stringContaining("not " + questId) });
    expect(row.status).toBe("WORKING");
  });

  it("keeps Landing out of hand-planned Journeys", async () => {
    caller = "leader";
    const res = await app.request(`/sessions/leader/board/${questId}/revise`, {
      method: "POST",
      body: JSON.stringify({ fromIndex: 1, expectedPhaseId: "memory", phases: ["memory", "landing"] }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("Landing is not planned by hand") });
  });
});
