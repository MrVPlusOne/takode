import { randomBytes } from "node:crypto";
import {
  LANDING_BATCH_LIMIT,
  LANDING_RUN_STALE_MS,
  landingLeaseKey,
  landingQueueKey,
  type LandingCommitMapping,
  type LandingEntry,
  type LandingPreSubmitTest,
  type LandingPushPlan,
  type LandingQueueSnapshot,
  type LandingRun,
  type LandingRunReport,
  type LandingTarget,
} from "../shared/landing-queue.js";
import { emptyLandingQueueFile, LandingQueueStore, type LandingQueueFile } from "./landing-queue-store.js";
import type { ResourceLeaseManager } from "./resource-lease-manager.js";

const LOG_TAG = "[landing-queue]";
const SWEEP_INTERVAL_MS = 30_000;
/** Resolved entries and finished runs are kept this long for status and receipts. */
const HISTORY_RETENTION_MS = 14 * 24 * 60 * 60_000;
const MAX_KEPT_RUNS = 100;
const MAX_DETAILS = 6000;
/** Lease lifetime for a landing waiter; the landing run renews with its own shorter TTL. */
const LANDING_WAIT_TTL_MS = 30 * 60_000;

export class LandingQueueError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

export interface LandingQueueDeps {
  leases: Pick<ResourceLeaseManager, "acquire" | "withdraw" | "release" | "holdsLease">;
  /** Deliver a message to a session's conversation. */
  notify: (sessionId: string, text: string) => void;
  sessionNum?: (sessionId: string) => number | undefined;
  /** Display name of the machine a session runs on. */
  machineName?: (hostId: string | undefined) => string;
  now?: () => number;
}

export interface LandingSubmitInput {
  callerSessionId: string;
  hostId?: string;
  target: LandingTarget;
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

/**
 * The landing queue for shared remote branches. The branch's port lease is the
 * single lock: every owner of a waiting entry holds or waits for it, and the
 * holder runs one landing run for all waiting entries. Resolving an entry
 * removes its owner from the lease queue, so only owners of still-waiting
 * entries are ever promoted to run the queue.
 */
export class LandingQueueManager {
  private data: LandingQueueFile = emptyLandingQueueFile();
  private loaded: Promise<void> | null = null;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private operationQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private deps: LandingQueueDeps,
    private store = new LandingQueueStore(),
  ) {}

  async start(): Promise<void> {
    await this.ensureLoaded();
    await this.sweep();
    this.sweepTimer = setInterval(() => void this.sweep().catch(logError), SWEEP_INTERVAL_MS);
  }

  destroy(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
  }

  async submit(input: LandingSubmitInput): Promise<{ entry: LandingEntry; lease: string; position?: number }> {
    return this.exclusive(async () => {
      if (input.commits.length === 0) throw new LandingQueueError(400, "An entry needs at least one commit.");
      const key = landingQueueKey(input.target);
      const active = this.data.entries.find(
        (entry) =>
          entry.sessionId === input.callerSessionId && (entry.state === "pending" || entry.state === "running"),
      );
      if (active)
        throw new LandingQueueError(
          409,
          `Entry ${active.id} from this session is still ${active.state}. Withdraw it before submitting another.`,
        );
      const entry: LandingEntry = {
        id: `le-${randomBytes(4).toString("hex")}`,
        key,
        target: { repo: input.target.repo.toLowerCase(), branch: input.target.branch },
        sessionId: input.callerSessionId,
        ...optional("sessionNum", this.deps.sessionNum?.(input.callerSessionId)),
        ...optional("hostId", input.hostId),
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
      const lease = await this.joinLeaseQueue(entry);
      return { entry, ...lease };
    });
  }

  async snapshot(target: LandingTarget): Promise<LandingQueueSnapshot> {
    return this.exclusive(async () => {
      const key = landingQueueKey(target);
      const runs = this.data.runs.filter((run) => run.key === key);
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
      };
    });
  }

  async getEntry(entryId: string): Promise<LandingEntry | undefined> {
    return this.exclusive(async () => this.data.entries.find((entry) => entry.id === entryId));
  }

  /** The caller's most recent entry, optionally for one quest. */
  async latestEntryFor(sessionId: string, questId?: string): Promise<LandingEntry | undefined> {
    return this.exclusive(async () =>
      this.data.entries
        .filter((entry) => entry.sessionId === sessionId && (!questId || entry.questId === questId))
        .sort((a, b) => b.submittedAt - a.submittedAt)
        .at(0),
    );
  }

  /** Start a landing run for every waiting entry. The caller must hold the target's port lease. */
  async claim(callerSessionId: string, target: LandingTarget, hostId?: string): Promise<LandingClaimResult> {
    return this.exclusive(async () => {
      const key = landingQueueKey(target);
      const leaseKey = landingLeaseKey(target);
      if (!this.deps.leases.holdsLease(leaseKey, callerSessionId))
        throw new LandingQueueError(409, `Hold ${leaseKey} before starting a landing run.`);
      const active = this.data.runs.find((run) => run.key === key && run.state === "running");
      if (active) {
        if (active.ownerSessionId === callerSessionId && this.now() - active.heartbeatAt < LANDING_RUN_STALE_MS)
          throw new LandingQueueError(409, `Landing run ${active.id} is already active (phase: ${active.phase}).`);
        // The caller holds the lease, so the earlier run lost it or stopped reporting.
        await this.abandon(active, "its lander no longer holds the lease or stopped reporting");
      }
      const unreconciled = this.data.runs.filter((run) => run.key === key && isUnreconciled(run));
      if (unreconciled.length > 0) return { entries: [], unreconciled };
      const entries = this.data.entries
        .filter((entry) => entry.key === key && entry.state === "pending")
        .sort((a, b) => a.submittedAt - b.submittedAt)
        .slice(0, LANDING_BATCH_LIMIT);
      if (entries.length === 0) {
        await this.releaseLease(target, callerSessionId);
        return { entries: [], unreconciled: [] };
      }
      const now = this.now();
      const run: LandingRun = {
        id: `lr-${randomBytes(4).toString("hex")}`,
        key,
        target: entries[0]!.target,
        ownerSessionId: callerSessionId,
        ...optional("ownerSessionNum", this.deps.sessionNum?.(callerSessionId)),
        ...optional("hostId", hostId),
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
      this.data.runs.push(run);
      await this.save();
      return { run, entries, unreconciled: [] };
    });
  }

  async heartbeat(runId: string, callerSessionId: string, phase?: string, logPath?: string): Promise<LandingRun> {
    return this.exclusive(async () => {
      const run = this.ownedRunningRun(runId, callerSessionId);
      run.heartbeatAt = this.now();
      if (phase) run.phase = phase.slice(0, 200);
      if (logPath) run.logPath = logPath;
      await this.save();
      return run;
    });
  }

  /** Record what is about to be pushed, so an interrupted run can be reconciled from it. */
  async recordPlan(runId: string, callerSessionId: string, plan: LandingPushPlan): Promise<LandingRun> {
    return this.exclusive(async () => {
      const run = this.ownedRunningRun(runId, callerSessionId);
      if (!this.deps.leases.holdsLease(landingLeaseKey(run.target), callerSessionId))
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

  async finish(runId: string, callerSessionId: string, report: LandingRunReport): Promise<LandingRun> {
    return this.exclusive(async () => {
      const run = this.ownedRunningRun(runId, callerSessionId);
      const reported = new Set(report.outcomes.map((outcome) => outcome.entryId));
      for (const entryId of run.entryIds) {
        if (!reported.has(entryId)) throw new LandingQueueError(400, `No outcome reported for entry ${entryId}.`);
      }
      run.state = "finished";
      run.finishedAt = this.now();
      run.summary = report.summary.slice(0, 2000);
      if (report.logPath) run.logPath = report.logPath;
      await this.applyOutcomes(run, report);
      return run;
    });
  }

  /** Settle an abandoned run that recorded a push plan: the lander checked whether its tip reached the remote. */
  async reconcile(runId: string, callerSessionId: string, pushed: boolean): Promise<LandingRun> {
    return this.exclusive(async () => {
      const run = this.data.runs.find((candidate) => candidate.id === runId);
      if (!run || !isUnreconciled(run)) throw new LandingQueueError(404, `No unreconciled run ${runId}.`);
      if (!this.deps.leases.holdsLease(landingLeaseKey(run.target), callerSessionId))
        throw new LandingQueueError(409, `Hold ${landingLeaseKey(run.target)} before reconciling a landing run.`);
      const plan = run.plan!;
      const outcomes: LandingRunReport["outcomes"] = run.entryIds.map((entryId) =>
        pushed && plan.mapping[entryId]
          ? { entryId, outcome: "landed", mapping: plan.mapping[entryId]! }
          : pushed
            ? { entryId, outcome: "bounced", reason: "It was dropped from the interrupted run's push." }
            : { entryId, outcome: "requeue", reason: "The interrupted run did not push." },
      );
      run.summary = `${run.summary ?? "Interrupted run"}; reconciled by #${this.deps.sessionNum?.(callerSessionId) ?? callerSessionId.slice(0, 8)}: ${pushed ? "its push reached the remote" : "nothing was pushed"}.`;
      run.plan = { ...plan, reconciled: true };
      await this.applyOutcomes(
        run,
        { outcomes, summary: run.summary, ...(pushed ? { pushedTip: plan.tip } : {}) },
        {
          keepLease: true,
        },
      );
      return run;
    });
  }

  async withdraw(entryId: string, callerSessionId: string, callerIsLeaderOf: (sessionId: string) => boolean) {
    return this.exclusive(async () => {
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
      await this.deps.leases.withdraw(landingLeaseKey(entry.target), entry.sessionId).catch(logError);
      return entry;
    });
  }

  /**
   * Whether the queue recorded this exact commit landing for the caller's entry.
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

  /** A session running or waiting inside an active landing run counts as making progress. */
  isLandingActive(sessionId: string): boolean {
    const now = this.now();
    return this.data.runs.some(
      (run) =>
        run.state === "running" &&
        now - run.heartbeatAt < LANDING_RUN_STALE_MS &&
        (run.ownerSessionId === sessionId ||
          run.entryIds.some((id) => this.data.entries.find((entry) => entry.id === id)?.sessionId === sessionId)),
    );
  }

  /** Abandon runs whose lander lost the port lease, and keep every waiting entry's owner in the lease queue. */
  async sweep(): Promise<void> {
    return this.exclusive(async () => {
      for (const run of this.data.runs.filter((candidate) => candidate.state === "running")) {
        if (!this.deps.leases.holdsLease(landingLeaseKey(run.target), run.ownerSessionId)) {
          await this.abandon(run, "its lander lost the port lease");
        }
      }
      this.prune();
    });
  }

  private async abandon(run: LandingRun, why: string): Promise<void> {
    console.warn(`${LOG_TAG} Abandoning landing run ${run.id}: ${why}`);
    run.state = "abandoned";
    run.finishedAt = this.now();
    run.summary = `Abandoned: ${why}.${run.plan ? " It recorded a push plan; the next landing run checks the remote." : ""}`;
    if (!run.plan) {
      for (const entry of this.runEntries(run)) {
        entry.state = "pending";
        delete entry.runId;
      }
    }
    await this.save();
    for (const entry of this.runEntries(run)) await this.joinLeaseQueue(entry).catch(logError);
  }

  private async applyOutcomes(
    run: LandingRun,
    report: LandingRunReport,
    options: { keepLease?: boolean } = {},
  ): Promise<void> {
    const now = this.now();
    const resolved: LandingEntry[] = [];
    const requeued: LandingEntry[] = [];
    for (const outcome of report.outcomes) {
      const entry = this.data.entries.find((candidate) => candidate.id === outcome.entryId);
      if (!entry) continue;
      if (outcome.outcome === "requeue") {
        entry.state = "pending";
        delete entry.runId;
        entry.reason = outcome.reason;
        requeued.push(entry);
        continue;
      }
      entry.resolvedAt = now;
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
    const leaseKey = landingLeaseKey(run.target);
    for (const entry of resolved) await this.deps.leases.withdraw(leaseKey, entry.sessionId).catch(logError);
    if (!options.keepLease) await this.releaseLease(run.target, run.ownerSessionId);
    for (const entry of this.data.entries.filter((candidate) => candidate.key === run.key)) {
      if (entry.state === "pending") await this.joinLeaseQueue(entry).catch(logError);
    }
    for (const entry of resolved) this.deps.notify(entry.sessionId, this.resultMessage(entry, run, report));
    for (const entry of requeued) {
      this.deps.notify(
        entry.sessionId,
        `[Landing queue] Your entry ${entry.id}${entry.questId ? ` for ${entry.questId}` : ""} is waiting again: ${entry.reason} You stay in the queue for ${leaseKey}; if the Resource Lease message arrives, run \`takode land run\`.`,
      );
    }
  }

  private resultMessage(entry: LandingEntry, run: LandingRun, report: LandingRunReport): string {
    const quest = entry.questId ? ` for ${entry.questId}` : "";
    const where = `${entry.target.branch} (run ${run.id} on ${this.deps.machineName?.(run.hostId) ?? "the lander's machine"}${run.logPath ? `, log ${run.logPath}` : ""})`;
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
        `Next: run \`takode land finish${entry.questId ? ` ${entry.questId}` : ""}\` in your worktree. It fast-forwards your base checkout, records port receipts and resets your worktree, then prints the work-to-memory command.`,
      ].join("\n");
    }
    return [
      `[Landing queue] Your change${quest} bounced from ${where} and did not land.`,
      "",
      `Reason: ${entry.reason}`,
      ...(entry.details ? ["", "```", entry.details.slice(-3000), "```"] : []),
      ...extras,
      "",
      "Fix it (or rebase onto the remote branch), rerun `takode land test`, re-prepare and seal if you use port tracking, then `takode land submit` again.",
    ].join("\n");
  }

  private async joinLeaseQueue(entry: LandingEntry): Promise<{ lease: string; position?: number }> {
    const result = await this.deps.leases.acquire({
      resourceKey: landingLeaseKey(entry.target),
      callerSessionId: entry.sessionId,
      ...optional("questId", entry.questId),
      purpose: `Land ${entry.questId ?? entry.id} through the landing queue`,
      metadata: { landingEntry: entry.id },
      ttlMs: LANDING_WAIT_TTL_MS,
      waitIfUnavailable: true,
    });
    return result.status === "queued" ? { lease: "queued", position: result.position } : { lease: result.status };
  }

  private async releaseLease(target: LandingTarget, sessionId: string): Promise<void> {
    await this.deps.leases.release(landingLeaseKey(target), sessionId).catch(() => undefined);
  }

  private ownedRunningRun(runId: string, callerSessionId: string): LandingRun {
    const run = this.data.runs.find((candidate) => candidate.id === runId);
    if (!run) throw new LandingQueueError(404, `No landing run ${runId}.`);
    if (run.ownerSessionId !== callerSessionId)
      throw new LandingQueueError(403, "Only the run's lander can update it.");
    if (run.state !== "running") throw new LandingQueueError(409, `Landing run ${runId} is ${run.state}.`);
    return run;
  }

  private runEntries(run: LandingRun): LandingEntry[] {
    return run.entryIds.flatMap((id) => this.data.entries.filter((entry) => entry.id === id));
  }

  private prune(): void {
    const cutoff = this.now() - HISTORY_RETENTION_MS;
    this.data.entries = this.data.entries.filter(
      (entry) => entry.state === "pending" || entry.state === "running" || (entry.resolvedAt ?? Infinity) > cutoff,
    );
    const keep = this.data.runs.filter((run) => run.state === "running" || isUnreconciled(run));
    const done = this.data.runs.filter((run) => !keep.includes(run) && (run.finishedAt ?? 0) > cutoff);
    this.data.runs = [...done.slice(-MAX_KEPT_RUNS), ...keep].sort((a, b) => a.startedAt - b.startedAt);
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

function optional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value === undefined || value === "" ? {} : { [key]: value }) as { [P in K]?: V };
}

function logError(error: unknown): void {
  console.warn(`${LOG_TAG}`, error);
}

export type { LandingCommitMapping };
