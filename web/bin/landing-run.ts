/**
 * One landing run: take every waiting landing-queue entry, stack them on the
 * remote branch tip in a dedicated checkout, gate the combined tree once and
 * push exactly the commit that was gated. A change that conflicts or breaks
 * the gate bounces back to its owner and the rest are re-gated without it.
 * Runs on the machine of the session holding the target's port lease.
 */
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  LandingCommitMapping,
  LandingEntry,
  LandingEntryOutcome,
  LandingPushPlan,
  LandingRun,
  LandingRunReport,
  LandingTarget,
} from "../shared/landing-queue.js";
import { commitChanges, git, isAncestor } from "./landing-git.js";
import {
  installDependencies,
  probeFails,
  readGateConfigAt,
  runGate,
  type GateRunOptions,
  type LandingGateConfig,
} from "./landing-gate.js";

export interface LandingRunApi {
  claim(target: LandingTarget): Promise<{ run?: LandingRun; entries: LandingEntry[]; unreconciled: LandingRun[] }>;
  heartbeat(runId: string, phase: string, logPath?: string): Promise<void>;
  plan(runId: string, plan: LandingPushPlan): Promise<void>;
  finish(runId: string, report: LandingRunReport): Promise<void>;
  reconcile(runId: string, pushed: boolean): Promise<void>;
  fetchBundle(bundleId: string): Promise<Buffer>;
  /** Extend the port lease; throws when this session no longer holds it. */
  renewLease(): Promise<void>;
}

export interface LandingRunOptions {
  api: LandingRunApi;
  target: LandingTarget;
  /** The machine's base checkout of the repository (shares objects with the landing checkout). */
  baseCheckout: string;
  /** Dedicated detached checkout the run builds and gates batches in. */
  landingDir: string;
  /** Directory for temporary baseline checkouts and bundle files. */
  scratchDir: string;
  log: (line: string) => void;
  logPath?: string;
  remote?: string;
  heartbeatMs?: number;
  env?: NodeJS.ProcessEnv;
}

interface Stacked {
  entry: LandingEntry;
  mapping: LandingCommitMapping[];
  tip: string;
}

export async function runLanding(options: LandingRunOptions): Promise<{ runId?: string; summary: string }> {
  const { api, target, baseCheckout: base, log } = options;
  const remote = options.remote ?? "origin";
  const remoteRef = `refs/remotes/${remote}/${target.branch}`;
  const started = Date.now();
  const timings: Record<string, number> = {};
  const time = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const start = Date.now();
    try {
      return await fn();
    } finally {
      timings[name] = (timings[name] ?? 0) + (Date.now() - start) / 1000;
    }
  };

  await time("fetch", () => git(base, ["fetch", "--quiet", remote, `+refs/heads/${target.branch}:${remoteRef}`]));
  let claim = await api.claim(target);
  for (let attempt = 0; claim.unreconciled.length > 0 && attempt < 3; attempt++) {
    for (const run of claim.unreconciled) {
      const pushed = await isAncestor(base, run.plan!.tip, remoteRef);
      log(`Reconciling interrupted run ${run.id}: its planned tip ${pushed ? "is" : "is not"} on ${remote}.`);
      await api.reconcile(run.id, pushed);
    }
    claim = await api.claim(target);
  }
  if (!claim.run) return { summary: "Nothing is waiting to land; released the lease." };
  const run = claim.run;
  log(
    `Landing run ${run.id}: ${claim.entries.length} entr${claim.entries.length === 1 ? "y" : "ies"} for ${target.repo}:${target.branch}.`,
  );

  let phase = "starting";
  let leaseLost = false;
  let beats = 0;
  const setPhase = (next: string) => {
    phase = next;
    log(`[phase] ${next}`);
    void api.heartbeat(run.id, next, options.logPath).catch(() => undefined);
  };
  const timer = setInterval(() => {
    void api.heartbeat(run.id, phase, options.logPath).catch(() => undefined);
    if (++beats % 2 === 0) void api.renewLease().catch(() => (leaseLost = true));
  }, options.heartbeatMs ?? 60_000);

  const outcomes = new Map<string, LandingEntryOutcome>();
  const bounce = (entry: LandingEntry, reason: string, details?: string) => {
    log(`Bounced ${entry.id}${entry.questId ? ` (${entry.questId})` : ""}: ${reason}`);
    outcomes.set(entry.id, { entryId: entry.id, outcome: "bounced", reason, ...(details ? { details } : {}) });
  };
  const flaky = new Set<string>();
  const preexisting = new Set<string>();
  let baselinePath: string | undefined;
  let pushedTip: string | undefined;
  let landed: Stacked[] = [];
  try {
    const baseSha = await git(base, ["rev-parse", remoteRef]);
    await git(base, ["var", "GIT_COMMITTER_IDENT"]).catch(() => {
      throw new Error("Git has no committer identity on this machine; set user.name and user.email.");
    });
    setPhase("preparing the landing checkout");
    await time("checkout", () => prepareLandingCheckout(base, options.landingDir, baseSha));
    const config = await readGateConfigAt(base, baseSha);
    if (!config) {
      for (const entry of claim.entries)
        bounce(
          entry,
          `${target.branch} declares no landing gate (.takode/landing-gate.json); land it with the classic port flow.`,
        );
      return await finish();
    }

    setPhase("fetching bundles");
    let remaining: LandingEntry[] = [];
    await mkdir(options.scratchDir, { recursive: true });
    await time("bundles", async () => {
      for (const entry of claim.entries) {
        const problem = await fetchEntry(options, entry, remoteRef);
        if (problem) bounce(entry, problem);
        else remaining.push(entry);
      }
    });

    const gateOptions = (dir: string): GateRunOptions => ({
      dir,
      config,
      log,
      env: options.env,
      phase: setPhase,
      baselineDir: async () => {
        baselinePath ??= await prepareBaseline(base, options.scratchDir, run.id, baseSha, config, gateOptions(dir));
        return baselinePath;
      },
    });

    // Each pass gates the stack it pushes; a bounce removes one entry and gates the rest again.
    while (remaining.length > 0) {
      setPhase(`stacking ${remaining.length} change(s)`);
      const stack = await time("stack", () => buildStack(options.landingDir, baseSha, remaining));
      for (const conflict of stack.conflicts) bounce(conflict.entry, conflict.reason);
      remaining = stack.stacked.map((item) => item.entry);
      if (stack.stacked.length === 0) break;
      const tip = stack.stacked.at(-1)!.tip;
      const tree = await git(options.landingDir, ["rev-parse", `${tip}^{tree}`]);
      const only = stack.stacked.length === 1 ? stack.stacked[0]!.entry.preSubmitTest : undefined;
      if (only?.kind === "passed" && only.tree === tree) {
        log(`The stack's tree ${tree} is the one its pre-submit run gated (${only.summary}); reusing that result.`);
        landed = stack.stacked;
        break;
      }
      setPhase(`gating ${stack.stacked.length} change(s)`);
      const gate = await time("gate", () => runGate(gateOptions(options.landingDir)));
      for (const name of gate.flaky) flaky.add(name);
      for (const name of gate.preexisting) preexisting.add(name);
      log(`Gate timings (s): ${JSON.stringify(gate.timings)}`);
      if (gate.ok) {
        landed = stack.stacked;
        break;
      }
      const culprit =
        stack.stacked.length === 1
          ? 0
          : await time("isolate", () =>
              findCulprit(options.landingDir, stack.stacked, gateOptions, setPhase, gate.probe!),
            );
      const details = [
        `Gate step "${gate.failedStep}" has new failures:`,
        ...gate.newFailures.slice(0, 30).map((id) => `- ${id}`),
        "",
        gate.excerpt,
      ].join("\n");
      bounce(
        stack.stacked[culprit]!.entry,
        stack.stacked.length === 1
          ? `The landing gate failed (${gate.failedStep}).`
          : `The landing gate failed (${gate.failedStep}) once this change was stacked on the ones ahead of it in the batch.`,
        details,
      );
      remaining = remaining.filter((entry) => entry.id !== stack.stacked[culprit]!.entry.id);
    }

    if (landed.length > 0) {
      const tip = landed.at(-1)!.tip;
      setPhase("pushing");
      const mapping = Object.fromEntries(landed.map((item) => [item.entry.id, item.mapping]));
      await api.plan(run.id, { base: baseSha, tip, mapping });
      if (leaseLost) throw new Error("The landing run lost the port lease before pushing.");
      await api.renewLease();
      try {
        await time("push", () =>
          git(options.landingDir, ["push", "--quiet", remote, `${tip}:refs/heads/${target.branch}`]),
        );
      } catch (error) {
        for (const item of landed)
          outcomes.set(item.entry.id, {
            entryId: item.entry.id,
            outcome: "requeue",
            reason: `The push was rejected (${(error as Error).message.split("\n")[0]}); the next landing run retries on the new tip.`,
          });
        landed = [];
        return await finish();
      }
      pushedTip = tip;
      for (const item of landed)
        outcomes.set(item.entry.id, { entryId: item.entry.id, outcome: "landed", mapping: item.mapping });
      await time("sync base", () => syncBaseCheckout(options, remoteRef, tip));
    }
    return await finish();
  } catch (error) {
    const message = (error as Error).message;
    log(`Landing run failed: ${message}`);
    for (const entry of claim.entries) {
      if (outcomes.has(entry.id)) continue;
      const item = pushedTip ? landed.find((candidate) => candidate.entry.id === entry.id) : undefined;
      outcomes.set(
        entry.id,
        item
          ? { entryId: entry.id, outcome: "landed", mapping: item.mapping }
          : { entryId: entry.id, outcome: "requeue", reason: `The landing run failed before pushing: ${message}` },
      );
    }
    return await finish();
  } finally {
    clearInterval(timer);
    if (baselinePath) await git(base, ["worktree", "remove", "--force", baselinePath]).catch(() => undefined);
    for (const entry of claim.entries)
      await git(base, ["update-ref", "-d", `refs/takode/landing/${entry.id}`]).catch(() => undefined);
  }

  async function finish(): Promise<{ runId: string; summary: string }> {
    const counts = { landed: 0, bounced: 0, requeue: 0 };
    for (const outcome of outcomes.values()) counts[outcome.outcome]++;
    timings.total = (Date.now() - started) / 1000;
    const summary =
      `Landed ${counts.landed} of ${claim.entries.length}` +
      (pushedTip ? ` (pushed ${pushedTip.slice(0, 10)})` : "") +
      (counts.bounced ? `, bounced ${counts.bounced}` : "") +
      (counts.requeue ? `, ${counts.requeue} waiting again` : "") +
      ".";
    log(`${summary} Timings (s): ${JSON.stringify(timings)}`);
    await api.finish(run.id, {
      outcomes: claim.entries.map(
        (entry) =>
          outcomes.get(entry.id) ?? {
            entryId: entry.id,
            outcome: "requeue",
            reason: "The run ended without an outcome.",
          },
      ),
      ...(pushedTip ? { pushedTip } : {}),
      summary,
      flaky: [...flaky],
      preexisting: [...preexisting],
      ...(options.logPath ? { logPath: options.logPath } : {}),
    });
    return { runId: run.id, summary };
  }
}

async function prepareLandingCheckout(base: string, dir: string, commit: string): Promise<void> {
  const exists = await stat(join(dir, ".git")).then(
    () => true,
    () => false,
  );
  if (!exists) {
    await git(base, ["worktree", "prune"]);
    await git(base, ["worktree", "add", "--quiet", "--detach", "--force", dir, commit]);
    return;
  }
  await git(dir, ["cherry-pick", "--abort"]).catch(() => undefined);
  await git(dir, ["checkout", "--quiet", "--detach", "--force", commit]);
  await git(dir, ["clean", "-qfdx", "-e", "node_modules"]);
}

/** Fetch an entry's bundle into the repository; returns a bounce reason when it cannot land. */
async function fetchEntry(options: LandingRunOptions, entry: LandingEntry, remoteRef: string): Promise<string | null> {
  const base = options.baseCheckout;
  const branch = options.target.branch;
  const rebase = `Rebase onto ${options.remote ?? "origin"}/${branch}, rerun \`takode land test\` and resubmit.`;
  const file = join(options.scratchDir, `${entry.id}.bundle`);
  try {
    await writeFile(file, await options.api.fetchBundle(entry.bundleId));
    if (!(await isAncestor(base, entry.base, remoteRef).catch(() => false)))
      return `Its base ${entry.base.slice(0, 10)} is not on ${options.remote ?? "origin"}/${branch}. ${rebase}`;
    await git(base, ["bundle", "verify", "--quiet", file]);
    const ref = `refs/takode/landing/${entry.id}`;
    await git(base, ["fetch", "--quiet", "--no-tags", file, `HEAD:${ref}`]);
    if ((await git(base, ["rev-parse", ref])) !== entry.tip) return "Its bundle does not end at the submitted tip.";
    if (await isAncestor(base, entry.tip, remoteRef)) return `Its commits are already on ${branch}.`;
    return null;
  } catch (error) {
    return `Its commits could not be fetched: ${(error as Error).message.split("\n")[0]}`;
  } finally {
    await rm(file, { force: true });
  }
}

/** Cherry-pick each entry's commits onto the base in order; a conflicting entry is left out. */
export async function buildStack(
  dir: string,
  baseSha: string,
  entries: LandingEntry[],
): Promise<{ stacked: Stacked[]; conflicts: { entry: LandingEntry; reason: string }[] }> {
  await git(dir, ["checkout", "--quiet", "--detach", "--force", baseSha]);
  const stacked: Stacked[] = [];
  const conflicts: { entry: LandingEntry; reason: string }[] = [];
  for (const entry of entries) {
    const start = await git(dir, ["rev-parse", "HEAD"]);
    const mapping: LandingCommitMapping[] = [];
    try {
      for (const commit of entry.commits) {
        try {
          await git(dir, ["cherry-pick", commit.sha]);
        } catch (error) {
          const files = await git(dir, ["diff", "--name-only", "--diff-filter=U"]).catch(() => "");
          throw new Error(
            files
              ? `Commit ${commit.sha.slice(0, 10)} conflicts in ${files.split("\n").join(", ")} with the changes ahead of it. Rebase onto the remote branch, rerun \`takode land test\` and resubmit.`
              : `Commit ${commit.sha.slice(0, 10)} does not apply: ${(error as Error).message.split("\n")[0]}`,
          );
        }
        const targetSha = await git(dir, ["rev-parse", "HEAD"]);
        const integrated = (await commitChanges(dir, commit.sha)) !== (await commitChanges(dir, targetSha));
        mapping.push({
          source: commit.sha,
          target: targetSha,
          subject: commit.subject,
          ...(integrated ? { integrated } : {}),
        });
      }
      stacked.push({ entry, mapping, tip: mapping.at(-1)!.target });
    } catch (error) {
      await git(dir, ["cherry-pick", "--abort"]).catch(() => undefined);
      await git(dir, ["reset", "--quiet", "--hard", start]);
      conflicts.push({ entry, reason: (error as Error).message });
    }
  }
  return { stacked, conflicts };
}

/**
 * Find the entry whose addition first makes the failure appear: binary search
 * over stack prefixes, running only the failing check. The base passes it and
 * the whole stack fails it.
 */
async function findCulprit(
  dir: string,
  stacked: Stacked[],
  gateOptions: (dir: string) => GateRunOptions,
  setPhase: (phase: string) => void,
  probe: NonNullable<Awaited<ReturnType<typeof runGate>>["probe"]>,
): Promise<number> {
  let passing = 0;
  let failing = stacked.length;
  const options = gateOptions(dir);
  while (failing - passing > 1) {
    const middle = Math.floor((passing + failing) / 2);
    setPhase(`isolating the failure: checking the first ${middle} of ${stacked.length} changes`);
    await git(dir, ["checkout", "--quiet", "--detach", "--force", stacked[middle - 1]!.tip]);
    await installDependencies(dir, options.config, options);
    if (await probeFails(dir, probe, options)) failing = middle;
    else passing = middle;
  }
  return failing - 1;
}

async function prepareBaseline(
  base: string,
  scratchDir: string,
  runId: string,
  commit: string,
  config: LandingGateConfig,
  options: GateRunOptions,
): Promise<string> {
  const dir = join(scratchDir, `baseline-${runId}`);
  await git(base, ["worktree", "add", "--quiet", "--detach", "--force", dir, commit]);
  await installDependencies(dir, config, options);
  return dir;
}

/** Fast-forward this machine's base checkout to the pushed tip when it is clean and on the branch. */
async function syncBaseCheckout(options: LandingRunOptions, remoteRef: string, tip: string): Promise<void> {
  const base = options.baseCheckout;
  await git(base, ["update-ref", remoteRef, tip]).catch(() => undefined);
  try {
    const branch = await git(base, ["symbolic-ref", "--short", "HEAD"]);
    if (branch !== options.target.branch) return options.log(`Base checkout is on ${branch}; not fast-forwarding it.`);
    if (await git(base, ["status", "--porcelain", "--untracked-files=no"]))
      return options.log("Base checkout has local changes; not fast-forwarding it.");
    await git(base, ["merge", "--quiet", "--ff-only", tip]);
    options.log(`Fast-forwarded the base checkout to ${tip.slice(0, 10)}.`);
  } catch (error) {
    options.log(`Could not fast-forward the base checkout: ${(error as Error).message}`);
  }
}
