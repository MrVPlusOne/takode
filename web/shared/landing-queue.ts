/**
 * Landing queue: ready changes for a shared remote branch wait here, and one
 * landing run at a time (whoever holds the branch's port lease) stacks them on
 * the remote tip, gates the combined tree once and pushes exactly that commit.
 * Shared by the server (queue state) and the `takode land` CLI (the run).
 */

/** Most entries one landing run takes; later ones wait for the next run. */
export const LANDING_BATCH_LIMIT = 8;

/** A run whose heartbeat is older than this no longer counts as making progress. */
export const LANDING_RUN_STALE_MS = 5 * 60_000;

export type LandingEntryState = "pending" | "running" | "landed" | "bounced" | "withdrawn";

export interface LandingTarget {
  /** Repository name from the base checkout's origin URL, e.g. `takode`. */
  repo: string;
  /** Remote branch the queue lands on, e.g. `jiayi`. */
  branch: string;
}

/** One source commit and the commit the landing run made from it on the target. */
export interface LandingCommitMapping {
  source: string;
  target: string;
  subject: string;
  /**
   * True when an earlier change in the same batch touched a file this commit
   * also changes, so the target commit's file changes differ from the sealed
   * ones (a conflict-free cherry-pick, gated as part of the batch).
   */
  integrated?: boolean;
}

/** What the submitting worker ran before submitting. */
export type LandingPreSubmitTest =
  | {
      kind: "passed";
      /** `git patch-id --stable` of the change, so a clean rebase keeps the record valid. */
      patchId: string;
      /** Tree the run tested; a landing run of exactly this tree reuses the result instead of re-gating. */
      tree: string;
      summary: string;
      at: number;
    }
  | { kind: "skipped"; reason: string };

export interface LandingEntry {
  id: string;
  /** Queue key, `<repo>:<branch>` in lower case. */
  key: string;
  target: LandingTarget;
  sessionId: string;
  sessionNum?: number;
  /** Remote host of the submitting session; absent for the coordinator's machine. */
  hostId?: string;
  questId?: string;
  /** Port-tracking preparation whose sealed commits this entry carries. */
  preparationId?: string;
  /** Server-stored Git bundle with the commits. */
  bundleId: string;
  /** Published commit the entry's commits start after. */
  base: string;
  tip: string;
  commits: { sha: string; subject: string }[];
  preSubmitTest: LandingPreSubmitTest;
  submittedAt: number;
  state: LandingEntryState;
  runId?: string;
  resolvedAt?: number;
  /** Target commits in order, once landed. */
  mapping?: LandingCommitMapping[];
  pushedTip?: string;
  /** Why the entry bounced or was withdrawn. */
  reason?: string;
  /** Failing output excerpt or other detail for the owner. */
  details?: string;
}

/** Recorded right before a push, so an interrupted run can be reconciled. */
export interface LandingPushPlan {
  base: string;
  tip: string;
  mapping: Record<string, LandingCommitMapping[]>;
  /** Set once a later lander checked whether this plan's tip reached the remote. */
  reconciled?: boolean;
}

export type LandingRunState = "running" | "finished" | "abandoned";

export interface LandingRun {
  id: string;
  key: string;
  target: LandingTarget;
  ownerSessionId: string;
  ownerSessionNum?: number;
  hostId?: string;
  startedAt: number;
  heartbeatAt: number;
  phase: string;
  entryIds: string[];
  state: LandingRunState;
  plan?: LandingPushPlan;
  finishedAt?: number;
  summary?: string;
  logPath?: string;
}

/** Per-entry outcome a landing run reports when it finishes. */
export type LandingEntryOutcome =
  | { entryId: string; outcome: "landed"; mapping: LandingCommitMapping[] }
  | { entryId: string; outcome: "bounced"; reason: string; details?: string }
  | { entryId: string; outcome: "requeue"; reason: string };

export interface LandingRunReport {
  outcomes: LandingEntryOutcome[];
  pushedTip?: string;
  summary: string;
  /** Tests that failed and then passed on rerun. */
  flaky?: string[];
  /** Failures that also happen on the batch's base. */
  preexisting?: string[];
  logPath?: string;
}

export interface LandingQueueSnapshot {
  key: string;
  leaseKey: string;
  entries: LandingEntry[];
  activeRun?: LandingRun;
  /** Abandoned runs that recorded a push plan and await reconciliation. */
  unreconciled: LandingRun[];
  recentRuns: LandingRun[];
}

export interface LandingGateStep {
  name: string;
  /** Directory relative to the checkout root. */
  cwd?: string;
  run: string[];
  /** `vitest` steps report per-test failures and can rerun single files. */
  kind?: "command" | "vitest";
}

/** A repository branch's full verification, stored on the Takode server. */
export interface LandingGateConfig {
  version: 1;
  /** Runs before the steps in every checkout the gate uses (e.g. a frozen dependency install). */
  install?: { cwd?: string; run: string[] };
  steps: LandingGateStep[];
}

/** A saved gate: its presence opts the repository branch into the landing queue. */
export interface LandingGateRecord {
  key: string;
  target: LandingTarget;
  config: LandingGateConfig;
  updatedAt: number;
  updatedBySessionId?: string;
  updatedBySessionNum?: number;
}

/** Validate a gate config document, keeping only its known fields. Throws a readable error otherwise. */
export function parseLandingGateConfig(raw: unknown): LandingGateConfig {
  const doc = raw as Partial<LandingGateConfig> | null;
  const isCommand = (run: unknown): run is string[] =>
    Array.isArray(run) && run.length > 0 && run.every((part) => typeof part === "string" && part);
  const checkCwd = (cwd: unknown, where: string) => {
    if (cwd !== undefined && (typeof cwd !== "string" || cwd.startsWith("/") || cwd.split("/").includes("..")))
      throw new Error(`${where}: cwd must be a directory inside the checkout, relative to its root.`);
    return cwd === undefined ? {} : { cwd };
  };
  if (!doc || typeof doc !== "object" || doc.version !== 1 || !Array.isArray(doc.steps) || doc.steps.length === 0)
    throw new Error("A landing gate needs version 1 and at least one step.");
  const steps = doc.steps.map((step, index): LandingGateStep => {
    const where = `step ${index + 1}`;
    if (!step || typeof step.name !== "string" || !step.name.trim() || !isCommand(step.run))
      throw new Error(`${where}: every step needs a name and a run command array.`);
    if (step.kind !== undefined && step.kind !== "command" && step.kind !== "vitest")
      throw new Error(`${where}: step kind must be command or vitest.`);
    return { name: step.name, ...checkCwd(step.cwd, where), run: step.run, ...(step.kind ? { kind: step.kind } : {}) };
  });
  if (new Set(steps.map((step) => step.name)).size !== steps.length) throw new Error("Step names must be unique.");
  if (doc.install !== undefined && !isCommand(doc.install?.run)) throw new Error("install needs a run command array.");
  return {
    version: 1,
    ...(doc.install ? { install: { ...checkCwd(doc.install.cwd, "install"), run: doc.install.run } } : {}),
    steps,
  };
}

export function landingQueueKey(target: LandingTarget): string {
  return `${target.repo}:${target.branch}`.toLowerCase();
}

/** The port lease that serializes landings on a target, shared by every machine. */
export function landingLeaseKey(target: LandingTarget): string {
  return `port:${landingQueueKey(target)}`;
}
