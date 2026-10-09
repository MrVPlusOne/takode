import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { isAbsolute } from "node:path";
import {
  LANDING_BATCH_LIMIT,
  LANDING_QUEUE_OWNER_PREFIX,
  LANDING_RUN_RECLAIM_MS,
  LANDING_RUN_STALE_MS,
  LANDING_RUNNER_SESSION_PREFIX,
  landingLeaseKey,
  landingQueueKey,
  landingQueueOwnerId,
  landingTargetFromKey,
  type LandingCommitMapping,
  type LandingEntry,
  type LandingPreSubmitTest,
  type LandingPushPlan,
  type LandingQueueSnapshot,
  type LandingRun,
  type LandingRunnerLaunch,
  type LandingRunReport,
  type LandingTarget,
} from "../shared/landing-queue.js";
import { LandingGateStore } from "./landing-gate-store.js";
import { emptyLandingQueueFile, LandingQueueStore, type LandingQueueFile } from "./landing-queue-store.js";
import type { ResourceLease } from "./resource-lease-types.js";
import type { ResourceLeaseManager } from "./resource-lease-manager.js";

const LOG_TAG = "[landing-queue]";
const SWEEP_INTERVAL_MS = 30_000;
/** Resolved entries, finished runs and ended runners are kept this long for status and receipts. */
const HISTORY_RETENTION_MS = 14 * 24 * 60 * 60_000;
const MAX_KEPT_RUNS = 100;
const MAX_KEPT_LAUNCHES = 100;
const MAX_DETAILS = 6000;
/** Port lease lifetime while the queue holds it; every runner heartbeat renews it. */
export const LANDING_QUEUE_LEASE_TTL_MS = 15 * 60_000;
/** A started runner that has not claimed its run by then is taken as one that failed to start. */
const LAUNCH_CLAIM_TIMEOUT_MS = 2 * 60_000;
/** Wait before the next attempt after 1, 2, 3 or more failures in a row (failed starts or failed runs). */
const RETRY_DELAYS_MS = [0, 60_000, 5 * 60_000, 15 * 60_000];
/** Leaders of the waiting changes hear about a queue that failed this many times in a row. */
const ALERT_AFTER_FAILURES = 2;

export class LandingQueueError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

/** What a runner process needs to start: where, for which queue, and its one-off credentials. */
export interface LandingRunnerRequest {
  launchId: string;
  target: LandingTarget;
  /** Remote host to start it on; absent for the coordinator's machine. */
  hostId?: string;
  baseCheckout: string;
  /** Sent as the runner's session ID and auth token. */
  sessionId: string;
  token: string;
}

/** A verified runner: the queue owner it acts as, and its launch. */
export interface LandingRunnerCaller {
  launchId: string;
  ownerId: string;
  target: LandingTarget;
  hostId?: string;
}

export interface LandingQueueDeps {
  leases: Pick<ResourceLeaseManager, "acquire" | "withdraw" | "release" | "holdsLease" | "renew"> &
    Partial<Pick<ResourceLeaseManager, "registerSystemOwner">>;
  /** Deliver a message to a session's conversation. */
  notify: (sessionId: string, text: string) => void;
  /** Start a landing runner process; rejects when it could not be started. Without it nothing lands. */
  launchRunner?: (request: LandingRunnerRequest) => Promise<void>;
  /**
   * Told first when an entry lands, bounces or is withdrawn. Returns true when
   * it took care of telling the owner (or deliberately did not), so the
   * queue's own message is skipped.
   */
  onEntryResolved?: (entry: LandingEntry) => Promise<boolean>;
  /** Tell the leaders of these entries' owners about a queue that keeps failing. */
  alertLeaders?: (entries: LandingEntry[], text: string) => void;
  sessionNum?: (sessionId: string) => number | undefined;
  /** Display name of the machine a session runs on. */
  machineName?: (hostId: string | undefined) => string;
  /** Republish a session's status row; called when its change starts or stops being in a landing run. */
  invalidateSession?: (sessionId: string) => void;
  now?: () => number;
}

export interface LandingSubmitInput {
  callerSessionId: string;
  hostId?: string;
  target: LandingTarget;
  /** The submitter's base checkout, where a landing run can start. */
  baseCheckout: string;
  questId?: string;
  preparationId?: string;
  bundleId: string;
  base: string;
  tip: string;
  commits: { sha: string; subject: string }[];
  preSubmitTest: LandingPreSubmitTest;
}

export interface LandingClaimResult {
  run?: LandingRun;
  entries: LandingEntry[];
  /** Abandoned runs with a recorded push plan; reconcile them before claiming. */
  unreconciled: LandingRun[];
}

interface QueueTrouble {
  failures: number;
  message: string;
  at: number;
  retryAt: number;
  alerted: boolean;
}

/**
 * The landing queue for shared remote branches. The branch's port lease is the
 * single lock, shared with classic ports. The queue holds it in its own name
 * (`landing-queue:<repo>:<branch>`) whenever changes wait, and then starts a
 * runner process on the machine of the oldest waiting change; the runner takes
 * every waiting entry as one landing run and reports its plan and outcome.
 * Nobody who submitted has to wait for, start or finish a run.
 */
export class LandingQueueManager {
  private data: LandingQueueFile = emptyLandingQueueFile();
  private loaded: Promise<void> | null = null;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private operationQueue: Promise<unknown> = Promise.resolve();
  /** Failures in a row per queue key, with the time of the next attempt. */
  private trouble = new Map<string, QueueTrouble>();
  /** Queue keys whose runner is being started right now. */
  private launching = new Set<string>();

  constructor(
    private deps: LandingQueueDeps,
    private store = new LandingQueueStore(),
    /** Saved gates; a repository branch without one is not opted into the queue. */
    readonly gates = new LandingGateStore(),
  ) {}

  async start(): Promise<void> {
    await this.ensureLoaded();
    this.deps.leases.registerSystemOwner?.(LANDING_QUEUE_OWNER_PREFIX, (lease) => this.onLeasePromoted(lease));
    await this.withdrawSessionWaiters();
    await this.sweep();
    this.sweepTimer = setInterval(() => void this.sweep().catch(logError), SWEEP_INTERVAL_MS);
  }

  destroy(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
  }

  async submit(input: LandingSubmitInput): Promise<{ entry: LandingEntry; ahead: number; activeRunId?: string }> {
    const result = await this.exclusive(async () => {
      if (input.commits.length === 0) throw new LandingQueueError(400, "An entry needs at least one commit.");
      if (!isAbsolute(input.baseCheckout))
        throw new LandingQueueError(400, "baseCheckout must be the absolute path of the base checkout.");
      const key = landingQueueKey(input.target);
      if (!(await this.gates.get(input.target)))
        throw new LandingQueueError(
          409,
          `No landing gate is saved for ${key}, so it does not land through the landing queue. Use the classic port flow in /port-changes, or save a gate with \`takode land gate save\`.`,
        );
      const active = this.data.entries.find(
        (entry) =>
          entry.sessionId === input.callerSessionId && (entry.state === "pending" || entry.state === "running"),
      );
      if (active)
        throw new LandingQueueError(
          409,
          `Entry ${active.id} from this session is still ${active.state}. Withdraw it before submitting another.`,
        );
      const waiting = this.data.entries.filter(
        (entry) => entry.key === key && (entry.state === "pending" || entry.state === "running"),
      );
      const entry: LandingEntry = {
        id: `le-${randomBytes(4).toString("hex")}`,
        key,
        target: { repo: input.target.repo.toLowerCase(), branch: input.target.branch },
        sessionId: input.callerSessionId,
        ...optional("sessionNum", this.deps.sessionNum?.(input.callerSessionId)),
        ...optional("hostId", input.hostId),
        baseCheckout: input.baseCheckout,
        ...optional("questId", input.questId),
        ...optional("preparationId", input.preparationId),
        bundleId: input.bundleId,
        base: input.base,
        tip: input.tip,
        commits: input.commits,
        preSubmitTest: input.preSubmitTest,
        submittedAt: this.now(),
        state: "pending",
      };
      this.data.entries.push(entry);
      await this.save();
      const activeRun = this.data.runs.find((run) => run.key === key && run.state === "running");
      return { entry, ahead: waiting.length, ...optional("activeRunId", activeRun?.id) };
    });
    this.pumpSoon(result.entry.key);
    return result;
  }

  async snapshot(target: LandingTarget): Promise<LandingQueueSnapshot> {
    return this.exclusive(async () => {
      const key = landingQueueKey(target);
      const runs = this.data.runs.filter((run) => run.key === key);
      const owner = landingQueueOwnerId(target);
      const launch = this.data.launches.filter((candidate) => candidate.key === key).at(-1);
      const trouble = this.trouble.get(key);
      const waiting = this.data.entries.some((entry) => entry.key === key && entry.state === "pending");
      return {
        key,
        leaseKey: landingLeaseKey(target),
        entries: this.data.entries
          .filter((entry) => entry.key === key)
          .sort((a, b) => a.submittedAt - b.submittedAt)
          .slice(-40),
        ...optional(
          "activeRun",
          runs.find((run) => run.state === "running"),
        ),
        unreconciled: runs.filter(isUnreconciled),
        recentRuns: runs.filter((run) => run.state !== "running").slice(-10),
        queueLease: this.deps.leases.holdsLease(landingLeaseKey(target), owner) ? "held" : waiting ? "waiting" : "none",
        ...(launch ? { launch: publicLaunch(launch) } : {}),
        ...(trouble ? { launchProblem: { message: trouble.message, at: trouble.at, retryAt: trouble.retryAt } } : {}),
      };
    });
  }

  async getEntry(entryId: string): Promise<LandingEntry | undefined> {
    return this.exclusive(async () => this.data.entries.find((entry) => entry.id === entryId));
  }

  /**
   * Start a runner now, on the caller's machine: the escape hatch for when the
   * server cannot start one (or a leader wants it elsewhere). The queue takes
   * the port lease the usual way; this never jumps ahead of a classic port.
   */
  async startRunnerByHand(input: {
    callerSessionId: string;
    target: LandingTarget;
    hostId?: string;
    baseCheckout: string;
  }): Promise<LandingRunnerRequest> {
    return this.exclusive(async () => {
      const key = landingQueueKey(input.target);
      if (!isAbsolute(input.baseCheckout))
        throw new LandingQueueError(400, "baseCheckout must be the absolute path of the base checkout.");
      const active = this.data.runs.find((run) => run.key === key && run.state === "running");
      if (active && this.now() - active.heartbeatAt < LANDING_RUN_RECLAIM_MS)
        throw new LandingQueueError(
          409,
          `Landing run ${active.id} is under way (phase: ${active.phase}); it takes every waiting change.`,
        );
      const waiting = this.data.entries.some((entry) => entry.key === key && entry.state === "pending");
      if (!waiting && !active && !this.data.runs.some((run) => run.key === key && isUnreconciled(run)))
        throw new LandingQueueError(409, `Nothing is waiting to land on ${key}.`);
      if (this.launching.has(key)) throw new LandingQueueError(409, "The server is starting a runner right now.");
      const leaseKey = landingLeaseKey(input.target);
      const owner = landingQueueOwnerId(input.target);
      if (!this.deps.leases.holdsLease(leaseKey, owner)) {
        const result = await this.deps.leases.acquire({
          resourceKey: leaseKey,
          callerSessionId: owner,
          purpose: `Land the waiting changes on ${input.target.branch} (landing queue)`,
          ttlMs: LANDING_QUEUE_LEASE_TTL_MS,
        });
        if (result.status === "unavailable")
          throw new LandingQueueError(
            409,
            `${leaseKey} is held by ${result.leases.map((lease) => lease.ownerSessionId).join(", ")} (a classic port or another landing). The queue starts its run as soon as it is free.`,
          );
      }
      if (active) await this.abandon(active, "a runner was started by hand after it stopped reporting");
      for (const open of this.data.launches.filter((launch) => launch.key === key && !launch.endedAt))
        open.endedAt = this.now();
      this.trouble.delete(key);
      const { launch, request } = this.newLaunch(input.target, input.hostId, input.baseCheckout, input.callerSessionId);
      await this.save();
      console.log(`${LOG_TAG} Runner ${launch.id} for ${key} started by hand by ${input.callerSessionId}`);
      return request;
    });
  }

  /** The runner a request's credentials name, or null. Synchronous: read from loaded state. */
  verifyRunner(sessionId: string | undefined, token: string | undefined): LandingRunnerCaller | null {
    if (!sessionId?.startsWith(LANDING_RUNNER_SESSION_PREFIX) || !token) return null;
    const id = sessionId.slice(LANDING_RUNNER_SESSION_PREFIX.length);
    const launch = this.data.launches.find((candidate) => candidate.id === id);
    if (!launch || launch.endedAt) return null;
    const expected = Buffer.from(launch.tokenHash, "hex");
    const actual = createHash("sha256").update(token).digest();
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    return {
      launchId: launch.id,
      ownerId: landingQueueOwnerId(launch.target),
      target: launch.target,
      ...optional("hostId", launch.hostId),
    };
  }

  /** Start a landing run for every waiting entry. Only the queue's current runner may. */
  async claim(runner: LandingRunnerCaller, target: LandingTarget): Promise<LandingClaimResult> {
    return this.exclusive(async () => {
      const key = landingQueueKey(target);
      const leaseKey = landingLeaseKey(target);
      const launch = this.currentLaunch(runner, key);
      if (launch.runId) throw new LandingQueueError(409, `Runner ${launch.id} already claimed run ${launch.runId}.`);
      if (!this.deps.leases.holdsLease(leaseKey, runner.ownerId))
        throw new LandingQueueError(409, `The landing queue no longer holds ${leaseKey}.`);
      const active = this.data.runs.find((run) => run.key === key && run.state === "running");
      if (active) await this.abandon(active, "a newer runner took over the queue");
      const unreconciled = this.data.runs.filter((run) => run.key === key && isUnreconciled(run));
      if (unreconciled.length > 0) return { entries: [], unreconciled };
      const entries = this.data.entries
        .filter((entry) => entry.key === key && entry.state === "pending")
        .sort((a, b) => a.submittedAt - b.submittedAt)
        .slice(0, LANDING_BATCH_LIMIT);
      if (entries.length === 0) {
        launch.endedAt = this.now();
        await this.save();
        await this.releaseLease(target);
        return { entries: [], unreconciled: [] };
      }
      const now = this.now();
      const run: LandingRun = {
        id: `lr-${randomBytes(4).toString("hex")}`,
        key,
        target: entries[0]!.target,
        ownerSessionId: runner.ownerId,
        launchId: launch.id,
        ...optional("hostId", launch.hostId),
        startedAt: now,
        heartbeatAt: now,
        phase: "starting",
        entryIds: entries.map((entry) => entry.id),
        state: "running",
      };
      for (const entry of entries) {
        entry.state = "running";
        entry.runId = run.id;
      }
      launch.runId = run.id;
      this.data.runs.push(run);
      await this.save();
      this.republishRun(run);
      return { run, entries, unreconciled: [] };
    });
  }

  /** Whether a bundle carries one of the changes in the runner's own run. */
  async runCarriesBundle(runId: string, runner: LandingRunnerCaller, bundleId: string): Promise<boolean> {
    return this.exclusive(async () => {
      const run = this.data.runs.find((candidate) => candidate.id === runId);
      return Boolean(
        run?.launchId === runner.launchId && this.runEntries(run).some((entry) => entry.bundleId === bundleId),
      );
    });
  }

  /** Record that the run is alive; this also renews the queue's port lease. */
  async heartbeat(runId: string, runner: LandingRunnerCaller, phase?: string, logPath?: string): Promise<LandingRun> {
    return this.exclusive(async () => {
      const run = this.ownedRunningRun(runId, runner);
      const leaseKey = landingLeaseKey(run.target);
      if (!this.deps.leases.holdsLease(leaseKey, runner.ownerId))
        throw new LandingQueueError(409, "The landing run no longer holds the port lease.");
      await this.deps.leases.renew({
        resourceKey: leaseKey,
        callerSessionId: runner.ownerId,
        ttlMs: LANDING_QUEUE_LEASE_TTL_MS,
      });
      run.heartbeatAt = this.now();
      if (phase) run.phase = phase.slice(0, 200);
      if (logPath) run.logPath = logPath;
      await this.save();
      return run;
    });
  }

  /** Record what is about to be pushed, so an interrupted run can be reconciled from it. */
  async recordPlan(runId: string, runner: LandingRunnerCaller, plan: LandingPushPlan): Promise<LandingRun> {
    return this.exclusive(async () => {
      const run = this.ownedRunningRun(runId, runner);
      if (!this.deps.leases.holdsLease(landingLeaseKey(run.target), runner.ownerId))
        throw new LandingQueueError(409, "The landing run no longer holds the port lease; do not push.");
      for (const entryId of Object.keys(plan.mapping)) {
        if (!run.entryIds.includes(entryId)) throw new LandingQueueError(400, `Entry ${entryId} is not in this run.`);
      }
      run.plan = plan;
      run.heartbeatAt = this.now();
      run.phase = "pushing";
      await this.save();
      return run;
    });
  }

  async finish(runId: string, runner: LandingRunnerCaller, report: LandingRunReport): Promise<LandingRun> {
    const run = await this.exclusive(async () => {
      const run = this.ownedRunningRun(runId, runner);
      const reported = new Set(report.outcomes.map((outcome) => outcome.entryId));
      for (const entryId of run.entryIds) {
        if (!reported.has(entryId)) throw new LandingQueueError(400, `No outcome reported for entry ${entryId}.`);
      }
      run.state = "finished";
      run.finishedAt = this.now();
      run.summary = report.summary.slice(0, 2000);
      if (report.logPath) run.logPath = report.logPath;
      this.endLaunchOf(run);
      const settled = report.outcomes.some((outcome) => outcome.outcome !== "requeue");
      if (settled) this.trouble.delete(run.key);
      else
        this.recordFailure(
          run,
          `The landing run on ${this.machine(run.hostId)} landed nothing: ${firstRequeueReason(report)}`,
        );
      await this.applyOutcomes(run, report);
      await this.releaseLease(run.target);
      return run;
    });
    this.pumpSoon(run.key);
    return run;
  }

  /** Settle an abandoned run that recorded a push plan: the runner checked whether its tip reached the remote. */
  async reconcile(runId: string, runner: LandingRunnerCaller, pushed: boolean): Promise<LandingRun> {
    return this.exclusive(async () => {
      const run = this.data.runs.find((candidate) => candidate.id === runId);
      if (!run || !isUnreconciled(run)) throw new LandingQueueError(404, `No unreconciled run ${runId}.`);
      this.currentLaunch(runner, run.key);
      if (!this.deps.leases.holdsLease(landingLeaseKey(run.target), runner.ownerId))
        throw new LandingQueueError(409, `The landing queue no longer holds ${landingLeaseKey(run.target)}.`);
      const plan = run.plan!;
      const outcomes: LandingRunReport["outcomes"] = run.entryIds.map((entryId) =>
        pushed && plan.mapping[entryId]
          ? { entryId, outcome: "landed", mapping: plan.mapping[entryId]! }
          : pushed
            ? { entryId, outcome: "bounced", reason: "It was dropped from the interrupted run's push." }
            : { entryId, outcome: "requeue", reason: "The interrupted run did not push." },
      );
      run.summary = `${run.summary ?? "Interrupted run"}; reconciled by runner ${runner.launchId}: ${pushed ? "its push reached the remote" : "nothing was pushed"}.`;
      run.plan = { ...plan, reconciled: true };
      await this.applyOutcomes(run, { outcomes, summary: run.summary, ...(pushed ? { pushedTip: plan.tip } : {}) });
      return run;
    });
  }

  async withdraw(entryId: string, callerSessionId: string, callerIsLeaderOf: (sessionId: string) => boolean) {
    const entry = await this.exclusive(async () => {
      const entry = this.data.entries.find((candidate) => candidate.id === entryId);
      if (!entry) throw new LandingQueueError(404, `No landing entry ${entryId}.`);
      if (entry.sessionId !== callerSessionId && !callerIsLeaderOf(entry.sessionId))
        throw new LandingQueueError(403, "Only the entry's owner or its leader can withdraw it.");
      if (entry.state !== "pending")
        throw new LandingQueueError(409, `Entry ${entryId} is ${entry.state}; only waiting entries can be withdrawn.`);
      entry.state = "withdrawn";
      entry.resolvedAt = this.now();
      entry.reason = callerSessionId === entry.sessionId ? "Withdrawn by its owner." : "Withdrawn by its leader.";
      await this.save();
      return entry;
    });
    // The owner (or leader) asked for this, so nobody needs the queue's message; quest bookkeeping still runs.
    void this.deps.onEntryResolved?.(entry).catch(logError);
    this.pumpSoon(entry.key);
    return entry;
  }

  /**
   * Whether the queue recorded this exact commit landing for the session's entry.
   * Port tracking accepts such receipts even when an earlier change in the batch
   * touched the same file.
   */
  async attestsLanding(
    entryId: string,
    callerSessionId: string,
    preparationId: string,
    source: string,
    target: string,
  ): Promise<boolean> {
    return this.exclusive(async () => {
      const entry = this.data.entries.find((candidate) => candidate.id === entryId);
      return Boolean(
        entry &&
          entry.sessionId === callerSessionId &&
          entry.state === "landed" &&
          entry.preparationId === preparationId &&
          entry.mapping?.some((commit) => commit.source === source && commit.target === target),
      );
    });
  }

  /**
   * Whether the queue proves a sealed preparation never landed: an entry carried
   * it, every such entry bounced or was withdrawn, and none is waiting or landed.
   */
  async attestsUnlanded(preparationId: string, callerSessionId: string): Promise<boolean> {
    return this.exclusive(async () => {
      const entries = this.data.entries.filter(
        (entry) => entry.preparationId === preparationId && entry.sessionId === callerSessionId,
      );
      return entries.length > 0 && entries.every((entry) => entry.state === "bounced" || entry.state === "withdrawn");
    });
  }

  /**
   * A session whose change is inside an active landing run counts as making
   * progress, and so does the queue's own lease owner while its runner works.
   */
  isLandingActive(sessionId: string): boolean {
    const now = this.now();
    // The queue itself, as a holder of a port lease others wait for, progresses while its runner starts or runs.
    if (sessionId.startsWith(LANDING_QUEUE_OWNER_PREFIX)) {
      const key = sessionId.slice(LANDING_QUEUE_OWNER_PREFIX.length);
      return (
        this.data.runs.some(
          (run) => run.key === key && run.state === "running" && now - run.heartbeatAt < LANDING_RUN_STALE_MS,
        ) ||
        this.data.launches.some(
          (launch) =>
            launch.key === key && !launch.endedAt && !launch.runId && now - launch.launchedAt < LAUNCH_CLAIM_TIMEOUT_MS,
        )
      );
    }
    return this.data.runs.some(
      (run) =>
        run.state === "running" &&
        now - run.heartbeatAt < LANDING_RUN_STALE_MS &&
        run.entryIds.some((id) => this.data.entries.find((entry) => entry.id === id)?.sessionId === sessionId),
    );
  }

  /** Whether a landing run is under way on a remote host; one that stopped reporting no longer counts. */
  isRunActiveOn(hostId: string): boolean {
    const now = this.now();
    return this.data.runs.some(
      (run) => run.state === "running" && run.hostId === hostId && now - run.heartbeatAt < LANDING_RUN_STALE_MS,
    );
  }

  /**
   * A runner process ended (the server saw it exit). A run it left behind is
   * taken back at once instead of waiting for its heartbeat to go stale.
   */
  async runnerExited(launchId: string, detail: string): Promise<void> {
    const key = await this.exclusive(async () => {
      const launch = this.data.launches.find((candidate) => candidate.id === launchId);
      if (!launch) return null;
      const run = launch.runId ? this.data.runs.find((candidate) => candidate.id === launch.runId) : undefined;
      if (run?.state === "running") {
        await this.abandon(run, `its runner exited (${detail})`);
        this.recordFailure(run, `The landing run on ${this.machine(run.hostId)} stopped before reporting (${detail}).`);
        await this.releaseLease(launch.target);
      } else if (!launch.runId && !launch.endedAt) {
        await this.launchFailed(launch, `The landing runner on ${this.machine(launch.hostId)} exited (${detail}).`);
      } else {
        launch.endedAt ??= this.now();
        await this.save();
      }
      return launch.key;
    });
    if (key) this.pumpSoon(key);
  }

  /**
   * Take back runs that lost the lease or stopped reporting, give up on runners
   * that never started, and start runners for queues with waiting changes.
   */
  async sweep(): Promise<void> {
    const keys = await this.exclusive(async () => {
      const now = this.now();
      for (const run of this.data.runs.filter((candidate) => candidate.state === "running")) {
        if (!this.deps.leases.holdsLease(landingLeaseKey(run.target), run.ownerSessionId)) {
          await this.abandon(run, "it lost the port lease");
        } else if (now - run.heartbeatAt > LANDING_RUN_RECLAIM_MS) {
          await this.abandon(run, "it stopped reporting");
          this.recordFailure(run, `The landing run on ${this.machine(run.hostId)} stopped reporting.`);
          await this.releaseLease(run.target);
        }
      }
      for (const launch of this.data.launches.filter((candidate) => !candidate.endedAt && !candidate.runId)) {
        if (this.launching.has(launch.key)) continue;
        if (!this.deps.leases.holdsLease(landingLeaseKey(launch.target), landingQueueOwnerId(launch.target))) {
          // The lease was taken away (expiry, a leader's force release): this runner can never claim.
          launch.endedAt = now;
          await this.save();
        } else if (now - launch.launchedAt > LAUNCH_CLAIM_TIMEOUT_MS)
          await this.launchFailed(
            launch,
            `The landing runner on ${this.machine(launch.hostId)} did not start its run.`,
          );
      }
      this.prune();
      return new Set([
        ...this.data.entries.filter((entry) => entry.state === "pending").map((entry) => entry.key),
        ...this.data.runs.filter((run) => isUnreconciled(run) || run.state === "running").map((run) => run.key),
        ...this.data.launches.filter((launch) => !launch.endedAt).map((launch) => launch.key),
      ]);
    });
    for (const key of keys) await this.pump(key);
  }

  private onLeasePromoted(lease: ResourceLease): void {
    this.pumpSoon(lease.ownerSessionId.slice(LANDING_QUEUE_OWNER_PREFIX.length));
  }

  private pumpSoon(key: string): void {
    setTimeout(() => void this.pump(key).catch(logError), 0);
  }

  /** Bring one queue forward: take the port lease and start a runner when changes wait and none runs. */
  private async pump(key: string): Promise<void> {
    const planned = await this.exclusive(() => this.planLaunch(key));
    if (!planned) return;
    const where = this.machine(planned.hostId);
    try {
      await this.deps.launchRunner!(planned);
      console.log(`${LOG_TAG} Started runner ${planned.launchId} for ${key} on ${where}`);
    } catch (error) {
      await this.exclusive(async () => {
        const launch = this.data.launches.find((candidate) => candidate.id === planned.launchId);
        if (launch && !launch.endedAt)
          await this.launchFailed(launch, `The landing runner could not start on ${where}: ${errorText(error)}`);
      });
    } finally {
      this.launching.delete(key);
    }
  }

  private async planLaunch(key: string): Promise<LandingRunnerRequest | null> {
    if (!this.deps.launchRunner || this.launching.has(key)) return null;
    if (this.data.runs.some((run) => run.key === key && run.state === "running")) return null;
    const pending = this.data.entries
      .filter((entry) => entry.key === key && entry.state === "pending")
      .sort((a, b) => a.submittedAt - b.submittedAt);
    const unreconciled = this.data.runs.filter((run) => run.key === key && isUnreconciled(run));
    const target = pending[0]?.target ?? unreconciled[0]?.target;
    if (!target) {
      // Nothing waits: the queue gives up the lease (or its place in line) for classic ports.
      await this.releaseLease(landingTargetFromKey(key));
      this.trouble.delete(key);
      return null;
    }
    const open = this.data.launches.find((launch) => launch.key === key && !launch.endedAt && !launch.runId);
    if (open) return null;
    const trouble = this.trouble.get(key);
    if (trouble && this.now() < trouble.retryAt) return null;
    const leaseKey = landingLeaseKey(target);
    const owner = landingQueueOwnerId(target);
    if (!this.deps.leases.holdsLease(leaseKey, owner)) {
      const result = await this.deps.leases.acquire({
        resourceKey: leaseKey,
        callerSessionId: owner,
        purpose: `Land the waiting changes on ${target.branch} (landing queue)`,
        ttlMs: LANDING_QUEUE_LEASE_TTL_MS,
        waitIfUnavailable: true,
      });
      // Classic ports hold the lease; the queue is promoted when it is free (onLeasePromoted).
      if (result.status === "queued") return null;
    }
    const machine = this.pickMachine(pending, unreconciled, trouble?.failures ?? 0);
    if (!machine) {
      this.recordFailureFor(key, pending, "No waiting change says where its repository is checked out.");
      await this.releaseLease(target);
      return null;
    }
    const { request } = this.newLaunch(target, machine.hostId, machine.baseCheckout);
    await this.save();
    this.launching.add(key);
    return request;
  }

  private newLaunch(
    target: LandingTarget,
    hostId: string | undefined,
    baseCheckout: string,
    startedBySessionId?: string,
  ): { launch: LandingRunnerLaunch; request: LandingRunnerRequest } {
    const token = randomBytes(24).toString("hex");
    const launch: LandingRunnerLaunch = {
      id: `ll-${randomBytes(4).toString("hex")}`,
      key: landingQueueKey(target),
      target,
      ...optional("hostId", hostId),
      baseCheckout,
      launchedAt: this.now(),
      tokenHash: createHash("sha256").update(token).digest("hex"),
      ...optional("startedBySessionId", startedBySessionId),
    };
    this.data.launches.push(launch);
    return {
      launch,
      request: {
        launchId: launch.id,
        target,
        ...optional("hostId", hostId),
        baseCheckout,
        sessionId: `${LANDING_RUNNER_SESSION_PREFIX}${launch.id}`,
        token,
      },
    };
  }

  /**
   * The machine of the oldest waiting change first; after failures in a row,
   * the next machine with a waiting change, so one broken machine does not
   * hold up the queue.
   */
  private pickMachine(
    pending: LandingEntry[],
    unreconciled: LandingRun[],
    failures: number,
  ): { hostId?: string; baseCheckout: string } | null {
    const candidates: { hostId?: string; baseCheckout: string }[] = [];
    const sources = [
      ...pending,
      ...unreconciled.flatMap((run) => this.runEntries(run)),
      ...this.data.launches.filter((launch) => unreconciled.some((run) => run.launchId === launch.id)),
    ];
    for (const source of sources) {
      if (!source.baseCheckout) continue;
      if (candidates.some((c) => c.hostId === source.hostId && c.baseCheckout === source.baseCheckout)) continue;
      candidates.push({ ...optional("hostId", source.hostId), baseCheckout: source.baseCheckout });
    }
    return candidates.length > 0 ? candidates[failures % candidates.length]! : null;
  }

  private async launchFailed(launch: LandingRunnerLaunch, message: string): Promise<void> {
    launch.endedAt = this.now();
    console.warn(`${LOG_TAG} ${message}`);
    this.recordFailureFor(
      launch.key,
      this.data.entries.filter((entry) => entry.key === launch.key && entry.state === "pending"),
      message,
    );
    await this.save();
    // Classic ports must not wait out the retry delay behind a queue that cannot run.
    await this.releaseLease(launch.target);
  }

  private recordFailure(run: LandingRun, message: string): void {
    this.recordFailureFor(run.key, this.runEntries(run), message);
  }

  private recordFailureFor(key: string, entries: LandingEntry[], message: string): void {
    const previous = this.trouble.get(key);
    const failures = (previous?.failures ?? 0) + 1;
    const now = this.now();
    const trouble: QueueTrouble = {
      failures,
      message,
      at: now,
      retryAt: now + RETRY_DELAYS_MS[Math.min(failures, RETRY_DELAYS_MS.length) - 1]!,
      alerted: previous?.alerted ?? false,
    };
    this.trouble.set(key, trouble);
    if (failures >= ALERT_AFTER_FAILURES && !trouble.alerted && entries.length > 0) {
      trouble.alerted = true;
      this.deps.alertLeaders?.(
        entries,
        [
          `[Landing queue] ${key} failed ${failures} times in a row and nothing landed. Latest: ${message}`,
          "",
          `It keeps retrying with growing delays. \`takode land status\` shows the queue; \`takode land run --branch ${landingTargetFromKey(key).branch}\` (in a checkout of the repository) starts a runner on your machine by hand.`,
        ].join("\n"),
      );
    }
  }

  /** The caller's launch, if it is the queue's current runner. */
  private currentLaunch(runner: LandingRunnerCaller, key: string): LandingRunnerLaunch {
    const launch = this.data.launches.find((candidate) => candidate.id === runner.launchId);
    if (!launch || launch.key !== key || launch.endedAt)
      throw new LandingQueueError(409, "This runner is not the queue's current runner any more.");
    return launch;
  }

  private endLaunchOf(run: LandingRun): void {
    const launch = this.data.launches.find((candidate) => candidate.id === run.launchId);
    if (launch && !launch.endedAt) launch.endedAt = this.now();
  }

  private async abandon(run: LandingRun, why: string): Promise<void> {
    console.warn(`${LOG_TAG} Abandoning landing run ${run.id}: ${why}`);
    run.state = "abandoned";
    run.finishedAt = this.now();
    run.summary = `Abandoned: ${why}.${run.plan ? " It recorded a push plan; the next landing run checks the remote." : ""}`;
    this.endLaunchOf(run);
    if (!run.plan) {
      for (const entry of this.runEntries(run)) {
        entry.state = "pending";
        delete entry.runId;
      }
    }
    await this.save();
    this.republishRun(run);
  }

  private async applyOutcomes(run: LandingRun, report: LandingRunReport): Promise<void> {
    const now = this.now();
    const resolved: LandingEntry[] = [];
    for (const outcome of report.outcomes) {
      const entry = this.data.entries.find((candidate) => candidate.id === outcome.entryId);
      if (!entry) continue;
      if (outcome.outcome === "requeue") {
        // It waits for the next run; the queue retries by itself, so its owner is not disturbed.
        entry.state = "pending";
        delete entry.runId;
        entry.reason = outcome.reason;
        continue;
      }
      entry.resolvedAt = now;
      // Reason and details describe the latest outcome only; an earlier
      // re-queue's reason must not survive a later landing or bounce.
      delete entry.reason;
      delete entry.details;
      if (outcome.outcome === "landed") {
        entry.state = "landed";
        entry.mapping = outcome.mapping;
        if (report.pushedTip) entry.pushedTip = report.pushedTip;
      } else {
        entry.state = "bounced";
        entry.reason = outcome.reason;
        if (outcome.details) entry.details = outcome.details.slice(-MAX_DETAILS);
      }
      resolved.push(entry);
    }
    await this.save();
    this.republishRun(run);
    setTimeout(() => void this.announce(resolved, run, report), 0);
  }

  /** Tell owners about their outcomes, after the quest side had its say. Runs outside the queue's lock. */
  private async announce(entries: LandingEntry[], run: LandingRun, report: LandingRunReport): Promise<void> {
    for (const entry of entries) {
      const handled = await (this.deps.onEntryResolved?.(entry) ?? Promise.resolve(false)).catch((error) => {
        logError(error);
        return false;
      });
      if (!handled) this.deps.notify(entry.sessionId, this.resultMessage(entry, run, report));
    }
  }

  private resultMessage(entry: LandingEntry, run: LandingRun, report: LandingRunReport): string {
    const quest = entry.questId ? ` for ${entry.questId}` : "";
    const where = `${entry.target.branch} (run ${run.id} on ${this.machine(run.hostId)}${run.logPath ? `, log ${run.logPath}` : ""})`;
    const extras = [
      report.flaky?.length ? `Flaky (failed, then passed on rerun): ${report.flaky.slice(0, 10).join(", ")}` : "",
      report.preexisting?.length
        ? `Already failing on the target, not blamed on this batch: ${report.preexisting.slice(0, 10).join(", ")}`
        : "",
    ].filter(Boolean);
    if (entry.state === "landed") {
      return [
        `[Landing queue] Your change${quest} landed on ${where}.`,
        "",
        `Target SHAs in order: ${entry.mapping!.map((commit) => commit.target).join(",")}`,
        ...extras,
        "",
        `Before more work in this worktree, reset it to origin/${entry.target.branch}.`,
      ].join("\n");
    }
    return [
      `[Landing queue] Your change${quest} bounced from ${where} and did not land.`,
      "",
      `Reason: ${entry.reason}`,
      ...(entry.details ? ["", "```", entry.details.slice(-3000), "```"] : []),
      ...extras,
      "",
      `Fix it (or rebase onto origin/${entry.target.branch}), rerun \`takode land test\`, re-prepare and seal if you use port tracking, then \`takode land submit\` again. \`takode land resume ${entry.id}\` restores the change in a worktree that no longer has it.`,
    ].join("\n");
  }

  /** Release the queue's port lease (or leave the lease's line). */
  private async releaseLease(target: LandingTarget): Promise<void> {
    const leaseKey = landingLeaseKey(target);
    const owner = landingQueueOwnerId(target);
    await this.deps.leases.release(leaseKey, owner).catch(() => undefined);
    await this.deps.leases.withdraw(leaseKey, owner).catch(() => undefined);
  }

  /**
   * Before server-started runs, every owner of a waiting change queued for the
   * port lease and was asked to run the queue when promoted. The queue now holds
   * the lease itself, so those sessions leave the line.
   */
  private async withdrawSessionWaiters(): Promise<void> {
    const entries = await this.exclusive(async () =>
      this.data.entries.filter((entry) => entry.state === "pending" || entry.state === "running"),
    );
    for (const entry of entries)
      await this.deps.leases.withdraw(landingLeaseKey(entry.target), entry.sessionId).catch(() => undefined);
  }

  private ownedRunningRun(runId: string, runner: LandingRunnerCaller): LandingRun {
    const run = this.data.runs.find((candidate) => candidate.id === runId);
    if (!run) throw new LandingQueueError(404, `No landing run ${runId}.`);
    if (run.launchId !== runner.launchId) throw new LandingQueueError(403, "Only the run's runner can update it.");
    if (run.state !== "running") throw new LandingQueueError(409, `Landing run ${runId} is ${run.state}.`);
    return run;
  }

  /** The owners of a run's changes show a landing run while it is active. */
  private republishRun(run: LandingRun): void {
    for (const sessionId of new Set(this.runEntries(run).map((entry) => entry.sessionId)))
      this.deps.invalidateSession?.(sessionId);
  }

  private runEntries(run: LandingRun): LandingEntry[] {
    return run.entryIds.flatMap((id) => this.data.entries.filter((entry) => entry.id === id));
  }

  private machine(hostId: string | undefined): string {
    return this.deps.machineName?.(hostId) ?? (hostId ? "a remote host" : "the coordinator's machine");
  }

  private prune(): void {
    const cutoff = this.now() - HISTORY_RETENTION_MS;
    this.data.entries = this.data.entries.filter(
      (entry) => entry.state === "pending" || entry.state === "running" || (entry.resolvedAt ?? Infinity) > cutoff,
    );
    const keep = this.data.runs.filter((run) => run.state === "running" || isUnreconciled(run));
    const done = this.data.runs.filter((run) => !keep.includes(run) && (run.finishedAt ?? 0) > cutoff);
    this.data.runs = [...done.slice(-MAX_KEPT_RUNS), ...keep].sort((a, b) => a.startedAt - b.startedAt);
    const open = this.data.launches.filter((launch) => !launch.endedAt);
    const ended = this.data.launches.filter((launch) => launch.endedAt && launch.endedAt > cutoff);
    this.data.launches = [...ended.slice(-MAX_KEPT_LAUNCHES), ...open].sort((a, b) => a.launchedAt - b.launchedAt);
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private async save(): Promise<void> {
    await this.store.save(this.data);
  }

  private async ensureLoaded(): Promise<void> {
    this.loaded ??= this.store.load().then((data) => {
      this.data = data;
    });
    await this.loaded;
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.operationQueue.then(async () => {
      await this.ensureLoaded();
      return fn();
    });
    this.operationQueue = run.catch(() => undefined);
    return run;
  }
}

function isUnreconciled(run: LandingRun): boolean {
  return run.state === "abandoned" && Boolean(run.plan) && !run.plan!.reconciled;
}

function publicLaunch(launch: LandingRunnerLaunch): Omit<LandingRunnerLaunch, "tokenHash"> {
  const { tokenHash: _tokenHash, ...rest } = launch;
  return rest;
}

function firstRequeueReason(report: LandingRunReport): string {
  const outcome = report.outcomes.find((candidate) => candidate.outcome === "requeue");
  return outcome && "reason" in outcome ? outcome.reason : report.summary;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function optional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value === undefined || value === "" ? {} : { [key]: value }) as { [P in K]?: V };
}

function logError(error: unknown): void {
  console.warn(`${LOG_TAG}`, error);
}

export type { LandingCommitMapping };
