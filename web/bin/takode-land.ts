/**
 * `takode land`: the landing queue for shared remote branches.
 *
 *   test     full gate on your own branch (rerun-and-compare), before submitting
 *   submit   send your commits to the queue and join the port lease queue
 *   run      (lease holder) start the background landing run for every waiting entry
 *   status   show the queue
 *   withdraw take a waiting entry back out
 *   finish   after "landed": sync the base checkout, record port receipts, reset
 *   gate     show, list, try, save or remove the branch's gate saved on the server
 */
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { constants as osConstants, homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  landingLeaseKey,
  landingQueueKey,
  parseLandingGateConfig,
  type LandingEntry,
  type LandingGateConfig,
  type LandingGateRecord,
  type LandingPreSubmitTest,
  type LandingQueueSnapshot,
  type LandingTarget,
} from "../shared/landing-queue.js";
import { git, isAncestor } from "./landing-git.js";
import {
  runGate,
  installDependencies,
  stopActiveGateCommands,
  type GateResult,
  type GateRunOptions,
} from "./landing-gate.js";
import { runLanding, type LandingRunApi } from "./landing-run.js";
import { apiDelete, apiGet, apiPost, getCallerSessionId } from "./takode-core.js";

export const LAND_HELP = `Usage: takode land <test|submit|run|status|withdraw|finish|gate> [flags]

Land changes on a shared remote branch through the landing queue. Waiting
changes are stacked on the remote tip and gated once together; the exact gated
commit is pushed. A repository branch uses the queue when a landing gate (its
full verification commands) is saved for it on the Takode server; see
\`takode land gate\`.

  takode land test
      Run the full gate on your branch with the rerun-and-compare rule (flaky
      tests rerun once; failures that also happen on your base don't count).
      Holds a slot of the per-machine full-suite:<repo> pool while it runs;
      exits 3 if queued (rerun after the Resource Lease message). Can take
      10+ minutes: run it as a background or long-running command.
  takode land submit [q-N] [--preparation <id>] [--skip-test <reason>]
      Send your commits (merge-base with the remote branch to HEAD) to the
      queue. Needs a passing \`takode land test\` for this change. Then end your
      turn and wait for the Landing Queue message.
  takode land run
      For the holder of port:<repo>:<branch>: start the background landing run
      for every waiting entry. Returns immediately.
  takode land status [--json]
  takode land withdraw <entry-id>
  takode land finish [q-N]
      After your change landed: fast-forward the base checkout, record
      port-tracking receipts, reset your worktree and print the
      work-to-memory command.
  takode land gate [show|list|try|save|remove]
      Check, try out and save the branch's landing gate (\`takode land gate
      --help\`).

Common flags: --branch <name> overrides the session's port target branch.
Exit codes: 0 ok, 1 failure, 3 queued for a lease.`;

const QUEUED_EXIT_CODE = 3;
/** Short enough that a slot whose holder died (even by SIGKILL) frees itself soon; renewed while held. */
const TEST_LEASE_TTL_MS = 10 * 60_000;
const TEST_LEASE_RENEW_MS = 2 * 60_000;
const RUN_LEASE_TTL_MS = 15 * 60_000;
const LANDING_HOME = join(homedir(), ".companion", "landing");

interface LandContext {
  worktree: string;
  baseCheckout: string;
  target: LandingTarget;
  remoteRef: string;
}

interface TestRecord {
  patchId: string;
  tree: string;
  head: string;
  base: string;
  ok: boolean;
  summary: string;
  at: number;
}

export async function handleLand(base: string, args: string[]): Promise<void> {
  const [command, ...rest] = args;
  const flags = parseFlags(rest);
  switch (command) {
    case "test":
      return landTest(base, flags);
    case "submit":
      return landSubmit(base, flags);
    case "run":
      return landRun(base, flags);
    case "status":
      return landStatus(base, flags);
    case "withdraw":
      return landWithdraw(base, flags);
    case "finish":
      return landFinish(base, flags);
    case "gate":
      return landGate(base, flags);
    default:
      console.log(LAND_HELP);
      if (command && command !== "help") process.exitCode = 1;
  }
}

type Flags = { positional: string[]; values: Map<string, string>; switches: Set<string> };

function parseFlags(args: string[]): Flags {
  const flags: Flags = { positional: [], values: new Map(), switches: new Set() };
  const withValue = new Set(["--branch", "--preparation", "--skip-test", "--log"]);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (withValue.has(arg)) {
      const value = args[++i];
      if (!value) throw new Error(`${arg} requires a value.`);
      flags.values.set(arg, value);
    } else if (arg.startsWith("--")) flags.switches.add(arg);
    else flags.positional.push(arg);
  }
  return flags;
}

async function resolveContext(base: string, flags: Flags): Promise<LandContext> {
  const cwd = process.cwd();
  const worktree = await git(cwd, ["rev-parse", "--show-toplevel"]);
  const common = await git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (basename(common) !== ".git") throw new Error(`Cannot find the base checkout for ${common}.`);
  const baseCheckout = dirname(common);
  const url = await git(baseCheckout, ["remote", "get-url", "origin"]).catch(() => {
    throw new Error(`The base checkout ${baseCheckout} has no origin remote; the landing queue needs a remote branch.`);
  });
  const repo = basename(url.replace(/\/+$/, ""))
    .replace(/\.git$/, "")
    .toLowerCase();
  let branch = flags.values.get("--branch");
  if (!branch) {
    const session = (await apiGet(base, `/sessions/${encodeURIComponent(getCallerSessionId())}`)) as {
      worktreePortTarget?: { branch?: string } | null;
      branch?: string;
    };
    branch = session.worktreePortTarget?.branch ?? session.branch;
  }
  if (!branch || branch === "HEAD")
    throw new Error("This session has no port target branch; pass --branch <remote branch>.");
  const remoteRef = `refs/remotes/origin/${branch}`;
  await git(baseCheckout, ["fetch", "--quiet", "origin", `+refs/heads/${branch}:${remoteRef}`]).catch((error) => {
    throw new Error(
      `origin/${branch} could not be fetched (${(error as Error).message}). The landing queue is for remote-backed targets; use the classic port flow otherwise.`,
    );
  });
  return { worktree, baseCheckout, target: { repo, branch }, remoteRef };
}

const NO_QUEUE_SERVER =
  "This Takode server has no landing queue yet (it needs a restart onto a build with `takode land`). Use the classic remote-backed port flow in /port-changes.";
const NO_GATES_SERVER =
  "This Takode server does not store landing gates yet (it needs a restart onto a build with `takode land gate`). Use the classic remote-backed port flow in /port-changes.";

/** Explain a server that predates the landing queue (or its saved gates) instead of a bare 404. */
async function landingApi<T>(call: () => Promise<unknown>, missing = NO_QUEUE_SERVER): Promise<T> {
  try {
    return (await call()) as T;
  } catch (error) {
    const message = (error as Error).message;
    if (/^(Not Found|HTTP 404|404)/.test(message)) throw new Error(missing);
    throw error;
  }
}

const targetQuery = (target: LandingTarget) =>
  `repo=${encodeURIComponent(target.repo)}&branch=${encodeURIComponent(target.branch)}`;

/** The gate saved for the target on the server, or null when it has none. */
async function savedGate(base: string, target: LandingTarget): Promise<LandingGateRecord | null> {
  const { gate } = await landingApi<{ gate: LandingGateRecord | null }>(
    () => apiGet(base, `/takode/land/gate?${targetQuery(target)}`),
    NO_GATES_SERVER,
  );
  return gate;
}

function noGateMessage(target: LandingTarget): string {
  return `No landing gate is saved for ${landingQueueKey(target)} on the Takode server, so it does not land through the landing queue. Use the classic port flow in /port-changes (\`takode land gate --help\` explains how a repository opts in).`;
}

async function changeBase(ctx: LandContext): Promise<{ baseSha: string; head: string; patchId: string; tree: string }> {
  const head = await git(ctx.worktree, ["rev-parse", "HEAD"]);
  const baseSha = await git(ctx.worktree, ["merge-base", "HEAD", ctx.remoteRef]);
  if (baseSha === head) throw new Error(`There are no commits after origin/${ctx.target.branch}.`);
  const tree = await git(ctx.worktree, ["rev-parse", "HEAD^{tree}"]);
  return { baseSha, head, tree, patchId: await patchId(ctx.worktree, baseSha) };
}

async function patchId(cwd: string, baseSha: string): Promise<string> {
  const diff = await git(cwd, ["diff", "--binary", "--full-index", baseSha, "HEAD"]);
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["patch-id", "--stable"], { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.on("error", reject);
    child.on("close", () => resolve(out.trim().split(/\s+/)[0] || ""));
    child.stdin.end(`${diff}\n`);
  });
}

async function assertClean(dir: string): Promise<void> {
  if (await git(dir, ["status", "--porcelain", "--untracked-files=no"]))
    throw new Error("Your worktree has uncommitted changes; commit them first.");
}

async function testRecordPath(ctx: LandContext, patch: string): Promise<string> {
  const dir = await git(ctx.worktree, ["rev-parse", "--path-format=absolute", "--git-path", "takode-land-tests"]);
  await mkdir(dir, { recursive: true });
  return join(dir, `${patch}.json`);
}

async function landTest(base: string, flags: Flags): Promise<void> {
  const ctx = await resolveContext(base, flags);
  await assertClean(ctx.worktree);
  const change = await changeBase(ctx);
  const gate = await savedGate(base, ctx.target);
  if (!gate) throw new Error(noGateMessage(ctx.target));
  const config = gate.config;
  const slot = await acquireFullSuiteSlot(base, ctx, "takode land test");
  if (!slot) return;
  const scratch = await mkdtemp(join(tmpdir(), "takode-land-test-"));
  const baselineDir = join(scratch, "baseline");
  let baselineReady = false;
  const log = (line: string) => console.log(line);
  let result: GateResult;
  try {
    console.log(
      `Gating ${change.head.slice(0, 10)} (base ${change.baseSha.slice(0, 10)}) with the landing gate saved for ${gate.key}.`,
    );
    const options: GateRunOptions = {
      dir: ctx.worktree,
      config,
      log,
      phase: (phase: string) => console.log(`[phase] ${phase}`),
      baselineDir: async () => {
        if (!baselineReady) {
          await git(ctx.worktree, ["worktree", "add", "--quiet", "--detach", "--force", baselineDir, change.baseSha]);
          await installDependencies(baselineDir, config, options);
          baselineReady = true;
        }
        return baselineDir;
      },
    };
    result = await runGate(options);
  } finally {
    if (baselineReady) await git(ctx.worktree, ["worktree", "remove", "--force", baselineDir]).catch(() => undefined);
    await rm(scratch, { recursive: true, force: true });
    await slot.release();
  }
  const summary = describeGate(result);
  const record: TestRecord = { ...change, base: change.baseSha, ok: result.ok, summary, at: Date.now() };
  await writeFile(await testRecordPath(ctx, change.patchId), JSON.stringify(record, null, 2));
  console.log("");
  console.log(result.ok ? `PASSED: ${summary}` : `FAILED: ${summary}`);
  if (!result.ok) {
    console.log(result.newFailures.map((id) => `- ${id}`).join("\n"));
    console.log(result.excerpt);
    process.exitCode = 1;
  } else {
    console.log("Next: `takode land submit` (add your quest ID and --preparation if you use port tracking).");
  }
}

/**
 * Take a slot of the per-machine full-suite:<repo> pool, renewed while held.
 * Returns null after printing QUEUED (exit code 3) when the pool is full.
 */
const STOP_SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];

async function acquireFullSuiteSlot(
  base: string,
  ctx: LandContext,
  command: string,
): Promise<{ release: () => Promise<void> } | null> {
  const pool = `full-suite:${ctx.target.repo}`;
  const acquired = (await apiPost(base, `/resource-leases/${encodeURIComponent(pool)}/acquire`, {
    purpose: `Full gate run (\`${command}\`); rerun it after this lease message`,
    wait: true,
    ttlMs: TEST_LEASE_TTL_MS,
  })) as { result: { status: string; position?: number; resourceKey?: string; lease?: { resourceKey: string } } };
  if (acquired.result.status === "queued") {
    console.log(
      `QUEUED for ${acquired.result.resourceKey ?? pool} at position ${acquired.result.position}. The full-suite pool caps concurrent full runs on this machine. End your turn; when the Resource Lease message arrives, run \`${command}\` again.`,
    );
    process.exitCode = QUEUED_EXIT_CODE;
    return null;
  }
  const leaseKey = acquired.result.lease?.resourceKey ?? pool;
  const renew = setInterval(
    () =>
      void apiPost(base, `/resource-leases/${encodeURIComponent(leaseKey)}/renew`, { ttlMs: TEST_LEASE_TTL_MS }).catch(
        () => undefined,
      ),
    TEST_LEASE_RENEW_MS,
  );
  let released: Promise<void> | null = null;
  const release = () =>
    (released ??= (async () => {
      clearInterval(renew);
      for (const signal of STOP_SIGNALS) process.off(signal, onStop);
      await apiPost(base, `/resource-leases/${encodeURIComponent(leaseKey)}/release`, {}).catch(() => undefined);
    })());
  // A stopped run (Ctrl-C, a killed tool call) stops its gate commands and frees the slot
  // before exiting; a run killed outright frees it when the short TTL lapses.
  const onStop = (signal: NodeJS.Signals) => {
    console.log(`Stopped by ${signal}; stopping the gate and releasing ${leaseKey}.`);
    stopActiveGateCommands("SIGTERM");
    void release().finally(() => process.exit(128 + (osConstants.signals[signal] ?? 15)));
  };
  for (const signal of STOP_SIGNALS) process.on(signal, onStop);
  return { release };
}

function describeGate(result: GateResult): string {
  const parts = [result.ok ? "no new failures" : `new failures in ${result.failedStep}`];
  if (result.flaky.length) parts.push(`${result.flaky.length} flaky (passed on rerun)`);
  if (result.preexisting.length) parts.push(`${result.preexisting.length} also failing on the base`);
  const seconds = Object.values(result.timings).reduce((sum, value) => sum + value, 0);
  return `${parts.join(", ")}; ${Math.round(seconds)}s`;
}

async function landSubmit(base: string, flags: Flags): Promise<void> {
  const ctx = await resolveContext(base, flags);
  await assertClean(ctx.worktree);
  const change = await changeBase(ctx);
  const rows = (await git(ctx.worktree, ["rev-list", "--reverse", "--parents", `${change.baseSha}..HEAD`]))
    .split("\n")
    .filter(Boolean);
  if (rows.some((row) => row.split(" ").length !== 2))
    throw new Error("The landing queue takes a linear series of commits; rebase away merge commits first.");
  const commits: { sha: string; subject: string }[] = [];
  for (const row of rows) {
    const sha = row.split(" ")[0]!;
    commits.push({ sha, subject: await git(ctx.worktree, ["show", "-s", "--format=%s", sha]) });
  }
  const skip = flags.values.get("--skip-test");
  let preSubmitTest: LandingPreSubmitTest;
  if (skip) preSubmitTest = { kind: "skipped", reason: skip };
  else {
    const record = (await readFile(await testRecordPath(ctx, change.patchId), "utf-8")
      .then((text) => JSON.parse(text) as TestRecord)
      .catch(() => null)) as TestRecord | null;
    if (!record?.ok)
      throw new Error(
        record
          ? "The last `takode land test` of this change failed. Fix it and rerun the test before submitting."
          : "No passing `takode land test` for this change. Run it first (or pass --skip-test <reason>).",
      );
    preSubmitTest = {
      kind: "passed",
      patchId: record.patchId,
      tree: record.tree,
      summary: record.summary,
      at: record.at,
    };
  }
  const questId = flags.positional.find((arg) => /^q-\d+$/.test(arg));
  const bundleId = await uploadBundle(base, ctx, change.baseSha, change.head, commits);
  const submitted = await landingApi<{ entry: LandingEntry; lease: string; position?: number }>(() =>
    apiPost(base, "/takode/land/submit", {
      target: ctx.target,
      ...(questId ? { questId } : {}),
      ...(flags.values.get("--preparation") ? { preparationId: flags.values.get("--preparation") } : {}),
      bundleId,
      base: change.baseSha,
      tip: change.head,
      commits,
      preSubmitTest,
    }),
  );
  console.log(
    `Submitted ${commits.length} commit(s) as landing entry ${submitted.entry.id} for ${ctx.target.repo}:${ctx.target.branch}.`,
  );
  if (submitted.lease === "queued") {
    console.log(
      `Queued for ${landingLeaseKey(ctx.target)} at position ${submitted.position}. End your turn. You will get a Landing Queue message when your change lands or bounces, or a Resource Lease message asking you to run \`takode land run\`.`,
    );
    return;
  }
  const logPath = await startDetachedRun(ctx);
  console.log(
    `You hold ${landingLeaseKey(ctx.target)}, so a background landing run started (log: ${logPath}). End your turn and wait for the Landing Queue message.`,
  );
}

async function uploadBundle(
  base: string,
  ctx: LandContext,
  baseSha: string,
  tip: string,
  commits: { sha: string; subject: string }[],
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "takode-land-bundle-"));
  try {
    const file = join(dir, "commits.bundle");
    await git(ctx.worktree, ["bundle", "create", "--quiet", file, `${baseSha}..HEAD`]);
    const { bundle } = (await apiPost(base, "/bundles", {
      branch: await git(ctx.worktree, ["rev-parse", "--abbrev-ref", "HEAD"]),
      base: baseSha,
      tip,
      commits,
      data: (await readFile(file)).toString("base64"),
    })) as { bundle: { id: string } };
    return bundle.id;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Start `takode land run --foreground` detached, logging to a file; returns the log path. */
async function startDetachedRun(ctx: LandContext): Promise<string> {
  const logDir = join(LANDING_HOME, "logs");
  await mkdir(logDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logPath = join(logDir, `${stamp}-${ctx.target.repo}-${ctx.target.branch.replace(/\//g, "_")}.log`);
  const handle = await open(logPath, "a");
  const script = process.argv[1]!;
  const child = spawn(
    process.execPath,
    [script, "land", "run", "--foreground", "--branch", ctx.target.branch, "--log", logPath],
    { cwd: ctx.worktree, detached: true, stdio: ["ignore", handle.fd, handle.fd], env: process.env },
  );
  child.unref();
  await handle.close();
  return logPath;
}

async function landRun(base: string, flags: Flags): Promise<void> {
  const ctx = await resolveContext(base, flags);
  if (!flags.switches.has("--foreground")) {
    const key = landingLeaseKey(ctx.target);
    const { resource } = (await apiGet(base, `/resource-leases/${encodeURIComponent(key)}`)) as {
      resource: { leases: { ownerSessionId: string }[] };
    };
    if (!resource.leases.some((lease) => lease.ownerSessionId === getCallerSessionId()))
      throw new Error(
        `You do not hold ${key}. If you submitted a change, end your turn: a Landing Queue or Resource Lease message will follow.`,
      );
    const logPath = await startDetachedRun(ctx);
    console.log(
      `Started the background landing run (log: ${logPath}). End your turn and wait for the Landing Queue message.`,
    );
    return;
  }
  const logPath = flags.values.get("--log");
  const log = (line: string) => console.log(`${new Date().toISOString()} ${line}`);
  const leaseKey = landingLeaseKey(ctx.target);
  const runApi: LandingRunApi = {
    claim: (target) => landingApi(() => apiPost(base, "/takode/land/runs", { target })),
    heartbeat: async (runId, phase, path) => {
      await apiPost(base, `/takode/land/runs/${runId}/heartbeat`, { phase, logPath: path });
    },
    plan: async (runId, plan) => {
      await withRetry(() => apiPost(base, `/takode/land/runs/${runId}/plan`, { plan }));
    },
    finish: async (runId, report) => {
      await withRetry(() => apiPost(base, `/takode/land/runs/${runId}/finish`, { report }));
    },
    reconcile: async (runId, pushed) => {
      await withRetry(() => apiPost(base, `/takode/land/runs/${runId}/reconcile`, { pushed }));
    },
    fetchBundle: async (bundleId) => {
      const { data } = (await apiGet(base, `/bundles/${encodeURIComponent(bundleId)}`)) as { data: string };
      return Buffer.from(data, "base64");
    },
    gate: async (target) => (await savedGate(base, target))?.config ?? null,
    renewLease: async () => {
      await apiPost(base, `/resource-leases/${encodeURIComponent(leaseKey)}/renew`, { ttlMs: RUN_LEASE_TTL_MS });
    },
  };
  const slug = `${ctx.target.repo}-${ctx.target.branch.replace(/[^A-Za-z0-9._-]/g, "_")}-${await shortHash(ctx.baseCheckout)}`;
  const result = await runLanding({
    api: runApi,
    target: ctx.target,
    baseCheckout: ctx.baseCheckout,
    landingDir: join(LANDING_HOME, "checkouts", slug),
    scratchDir: join(LANDING_HOME, "scratch", slug),
    log,
    ...(logPath ? { logPath } : {}),
  });
  log(result.summary);
}

async function shortHash(text: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(text).digest("hex").slice(0, 8);
}

/** Retry calls that must reach the server (for example across a coordinator restart). */
async function withRetry<T>(call: () => Promise<T>, attempts = 12): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      const message = (error as Error).message;
      const transient = /fetch failed|ECONNREFUSED|ECONNRESET|socket|HTTP 5\d\d|unreachable/i.test(message);
      if (!transient || attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(30_000, 2_000 * attempt)));
    }
  }
}

async function landStatus(base: string, flags: Flags): Promise<void> {
  const ctx = await resolveContext(base, flags);
  const snapshot = await landingApi<LandingQueueSnapshot>(() =>
    apiGet(base, `/takode/land/queue?${targetQuery(ctx.target)}`),
  );
  if (flags.switches.has("--json")) {
    console.log(JSON.stringify(snapshot, null, 2));
    return;
  }
  console.log(`Landing queue ${snapshot.key} (lease ${snapshot.leaseKey})`);
  const now = Date.now();
  const age = (at: number) => `${Math.round((now - at) / 60_000)}m`;
  if (snapshot.activeRun) {
    const run = snapshot.activeRun;
    console.log(
      `  running: ${run.id} by #${run.ownerSessionNum ?? run.ownerSessionId.slice(0, 8)}, ${run.entryIds.length} entr${run.entryIds.length === 1 ? "y" : "ies"}, ${age(run.startedAt)} so far, phase: ${run.phase}${run.logPath ? `, log ${run.logPath}` : ""}`,
    );
  }
  for (const run of snapshot.unreconciled)
    console.log(`  interrupted, awaiting the next run: ${run.id} (${run.summary ?? ""})`);
  const label = (entry: LandingEntry) =>
    `${entry.id} #${entry.sessionNum ?? entry.sessionId.slice(0, 8)}${entry.questId ? ` ${entry.questId}` : ""} ${entry.commits.length} commit(s)`;
  const waiting = snapshot.entries.filter((entry) => entry.state === "pending" || entry.state === "running");
  console.log(waiting.length ? "  waiting:" : "  nothing waiting");
  for (const entry of waiting)
    console.log(`    ${label(entry)} ${entry.state}, submitted ${age(entry.submittedAt)} ago`);
  const done = snapshot.entries.filter((entry) => entry.resolvedAt).slice(-8);
  if (done.length) console.log("  recent:");
  for (const entry of done)
    console.log(
      // A landed entry's stored reason can only be left over from an earlier attempt (entries saved before the server cleared it).
      `    ${label(entry)} ${entry.state} ${age(entry.resolvedAt!)} ago${entry.reason && entry.state !== "landed" ? `: ${entry.reason.split("\n")[0]}` : ""}`,
    );
}

async function landWithdraw(base: string, flags: Flags): Promise<void> {
  const id = flags.positional[0];
  if (!id || !/^le-[0-9a-f]{8}$/.test(id)) throw new Error("Usage: takode land withdraw <entry-id>");
  const { entry } = await landingApi<{ entry: LandingEntry }>(() =>
    apiPost(base, `/takode/land/entries/${id}/withdraw`, {}),
  );
  console.log(`Withdrew ${entry.id}.`);
}

async function landFinish(base: string, flags: Flags): Promise<void> {
  const questId = flags.positional.find((arg) => /^q-\d+$/.test(arg));
  const { entry } = await landingApi<{ entry: LandingEntry }>(() =>
    apiGet(base, `/takode/land/entries/latest${questId ? `?questId=${questId}` : ""}`),
  );
  if (entry.state !== "landed") {
    console.log(`Entry ${entry.id} is ${entry.state}${entry.reason ? `: ${entry.reason}` : ""}`);
    process.exitCode = 1;
    return;
  }
  const ctx = await resolveContext(base, { ...flags, values: new Map([["--branch", entry.target.branch]]) });
  const mapping = entry.mapping!;
  const lastTarget = mapping.at(-1)!.target;
  if (!(await isAncestor(ctx.baseCheckout, lastTarget, ctx.remoteRef)))
    throw new Error(`origin/${entry.target.branch} does not contain ${lastTarget}; fetch and retry.`);
  // Port receipts check the base checkout, so it must contain the landed commits first.
  if (!(await isAncestor(ctx.baseCheckout, lastTarget, "HEAD"))) {
    const branch = await git(ctx.baseCheckout, ["symbolic-ref", "--short", "HEAD"]).catch(() => "");
    if (
      branch !== entry.target.branch ||
      (await git(ctx.baseCheckout, ["status", "--porcelain", "--untracked-files=no"]))
    )
      throw new Error(
        `The base checkout ${ctx.baseCheckout} is not a clean checkout of ${entry.target.branch}; fast-forward it to origin/${entry.target.branch} and rerun.`,
      );
    await git(ctx.baseCheckout, ["merge", "--quiet", "--ff-only", ctx.remoteRef]);
    console.log(`Fast-forwarded ${ctx.baseCheckout} to origin/${entry.target.branch}.`);
  }
  if (entry.preparationId && entry.questId) {
    for (const commit of mapping) {
      await apiPost(base, `/takode/port/${entry.questId}/landed`, {
        id: entry.preparationId,
        workerSha: commit.source,
        targetSha: commit.target,
        landingEntryId: entry.id,
      });
    }
    console.log(`Recorded ${mapping.length} port receipt(s) for preparation ${entry.preparationId}.`);
  }
  const head = await git(ctx.worktree, ["rev-parse", "HEAD"]);
  const clean = !(await git(ctx.worktree, ["status", "--porcelain", "--untracked-files=no"]));
  if (clean && (head === entry.tip || (await isAncestor(ctx.worktree, head, ctx.remoteRef)))) {
    await git(ctx.worktree, ["reset", "--quiet", "--hard", ctx.remoteRef]);
    console.log(`Reset your worktree to origin/${entry.target.branch}.`);
  } else {
    console.log(
      "Your worktree has changes beyond the landed commits; it was not reset. Preserve that work, then reset to the target branch.",
    );
  }
  const shas = mapping.map((commit) => commit.target).join(",");
  const integrated = mapping.filter((commit) => commit.integrated).length;
  console.log("");
  console.log(`Port target used: ${ctx.baseCheckout} ${entry.target.branch} (landing queue entry ${entry.id})`);
  console.log(`Synced SHAs: ${shas}`);
  if (integrated)
    console.log(`${integrated} commit(s) were integrated with other changes in the same batch (same files).`);
  console.log(
    `Next: takode board work-to-memory ${entry.questId ?? "q-N"} --work-note <index> --commits ${shas}${entry.preparationId ? ` --preparation ${entry.preparationId}` : ""}`,
  );
}

export const LAND_GATE_HELP = `Usage: takode land gate [show|list|try|save|remove] [flags]

A landing gate is a repository branch's full verification: an optional
dependency install and the steps to run, each a command array run from a
directory of the checkout. It is saved on the Takode server for one repository
branch (the repository name from the origin URL, the branch from the session's
port target or --branch), and every machine's \`takode land\` uses that copy. A
branch with a saved gate lands through the landing queue; without one it uses
the classic port flow.

  takode land gate [show] [--json]
      Show the gate saved for this branch. --json prints only the config, a
      starting point for a draft.
  takode land gate list [--json]
      List every saved gate.
  takode land gate try <file|->
      Run a draft gate on your checkout as it is now, without saving it. Takes
      a slot of the per-machine full-suite:<repo> pool like \`takode land test\`
      (exit 3 when queued); can take as long as the full suite.
  takode land gate save <file|->
      Validate and save a gate for this branch, replacing the current one
      (whose config is printed so it can be restored).
  takode land gate remove
      Stop using the landing queue for this branch; prints the removed config.

Gate config (JSON; "kind": "vitest" lets the gate rerun single failing test
files, other steps compare their failure output with the base commit's):
  { "version": 1,
    "install": { "cwd": "web", "run": ["bun", "install", "--frozen-lockfile"] },
    "steps": [
      { "name": "typecheck", "cwd": "web", "run": ["bun", "run", "typecheck"] },
      { "name": "tests", "cwd": "web", "kind": "vitest", "run": ["bunx", "vitest", "run"] } ] }`;

async function landGate(base: string, flags: Flags): Promise<void> {
  const [command = "show", file] = flags.positional;
  if (flags.switches.has("--help") || command === "help") return void console.log(LAND_GATE_HELP);
  const json = flags.switches.has("--json");
  if (command === "list") {
    const { gates } = await landingApi<{ gates: LandingGateRecord[] }>(
      () => apiGet(base, "/takode/land/gates"),
      NO_GATES_SERVER,
    );
    if (json) return void console.log(JSON.stringify(gates, null, 2));
    if (gates.length === 0)
      return void console.log("No landing gates are saved; every branch uses the classic port flow.");
    for (const gate of gates) console.log(`${gate.key}  ${describeConfig(gate.config)}, ${savedBy(gate)}`);
    return;
  }
  if (!["show", "try", "save", "remove"].includes(command)) {
    console.log(LAND_GATE_HELP);
    process.exitCode = 1;
    return;
  }
  const ctx = await resolveContext(base, flags);
  const key = landingQueueKey(ctx.target);
  if (command === "show") {
    const gate = await savedGate(base, ctx.target);
    if (json) return void console.log(JSON.stringify(gate?.config ?? null, null, 2));
    if (!gate)
      return void console.log(
        `No landing gate is saved for ${key}; it lands with the classic port flow. To opt in, write a draft (\`takode land gate --help\`), check it with \`takode land gate try <file>\`, then \`takode land gate save <file>\`.`,
      );
    console.log(`Landing gate for ${key}: ${describeConfig(gate.config)}, ${savedBy(gate)}.`);
    console.log(JSON.stringify(gate.config, null, 2));
    return;
  }
  if (command === "remove") {
    const { removed } = await landingApi<{ removed: LandingGateRecord | null }>(
      () => apiDelete(base, `/takode/land/gate?${targetQuery(ctx.target)}`),
      NO_GATES_SERVER,
    );
    if (!removed) return void console.log(`No landing gate was saved for ${key}.`);
    console.log(`Removed the landing gate for ${key}; it now lands with the classic port flow. It was:`);
    console.log(JSON.stringify(removed.config, null, 2));
    return;
  }
  if (!file) throw new Error(`Usage: takode land gate ${command} <file|->`);
  const config = await readDraft(file);
  if (command === "save") {
    const { previous } = await landingApi<{ gate: LandingGateRecord; previous: LandingGateRecord | null }>(
      () => apiPost(base, "/takode/land/gate", { target: ctx.target, config }),
      NO_GATES_SERVER,
    );
    console.log(`Saved the landing gate for ${key}: ${describeConfig(config)}.`);
    if (previous && JSON.stringify(previous.config) !== JSON.stringify(config)) {
      console.log(`It replaced the gate ${savedBy(previous)}, which was:`);
      console.log(JSON.stringify(previous.config, null, 2));
    }
    return;
  }
  // try: run the draft on the checkout as it is, with reruns but no baseline to excuse failures.
  const slot = await acquireFullSuiteSlot(base, ctx, `takode land gate try ${file}`);
  if (!slot) return;
  let result: GateResult;
  try {
    const head = await git(ctx.worktree, ["rev-parse", "--short=10", "HEAD"]);
    console.log(`Trying the draft gate (${describeConfig(config)}) on ${ctx.worktree} at ${head}.`);
    result = await runGate({
      dir: ctx.worktree,
      config,
      log: (line) => console.log(line),
      phase: (phase) => console.log(`[phase] ${phase}`),
    });
  } finally {
    await slot.release();
  }
  const timings = Object.entries(result.timings)
    .map(([name, seconds]) => `${name} ${Math.round(seconds)}s`)
    .join(", ");
  console.log("");
  if (result.ok) {
    console.log(`PASSED${result.flaky.length ? ` (${result.flaky.length} flaky, passed on rerun)` : ""}: ${timings}.`);
    console.log(`Save it with \`takode land gate save ${file}\`.`);
    return;
  }
  console.log(`FAILED in step ${result.failedStep}: ${timings}.`);
  console.log(result.newFailures.map((id) => `- ${id}`).join("\n"));
  console.log(result.excerpt);
  process.exitCode = 1;
}

async function readDraft(file: string): Promise<LandingGateConfig> {
  const text = file === "-" ? await readStdin() : await readFile(file, "utf-8");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`${file === "-" ? "stdin" : file} is not valid JSON.`);
  }
  try {
    return parseLandingGateConfig(raw);
  } catch (error) {
    throw new Error(`${file === "-" ? "stdin" : file}: ${(error as Error).message}`);
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf-8");
}

function describeConfig(config: LandingGateConfig): string {
  return `${config.steps.length} step(s) (${config.steps.map((step) => step.name).join(", ")})${config.install ? " after an install" : ""}`;
}

function savedBy(gate: LandingGateRecord): string {
  const who =
    gate.updatedBySessionNum !== undefined
      ? ` by #${gate.updatedBySessionNum}`
      : gate.updatedBySessionId
        ? ` by ${gate.updatedBySessionId.slice(0, 8)}`
        : "";
  return `saved ${new Date(gate.updatedAt).toISOString().slice(0, 16).replace("T", " ")} UTC${who}`;
}
