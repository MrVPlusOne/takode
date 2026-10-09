/**
 * `takode land`: the landing queue for shared remote branches.
 *
 *   test     check your own branch before submitting: chosen tests, or the full gate (rerun-and-compare)
 *   submit   send your commits to the queue; the server starts the landing run
 *   run      (escape hatch) start a landing runner on this machine by hand
 *   status   show the queue
 *   withdraw take a waiting entry back out
 *   resume   put a bounced change back into this worktree
 *   gate     show, list, try, save or remove the branch's gate saved on the server
 */
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, open, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { constants as osConstants, homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  landingLeaseKey,
  FULL_SUITE_POOL_PREFIX,
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

export const LAND_HELP = `Usage: takode land <test|submit|run|status|withdraw|resume|gate> [flags]

Land changes on a shared remote branch through the landing queue. Waiting
changes are stacked on the remote tip and gated once together; the exact gated
commit is pushed. The server starts each landing run itself, on the machine of
the oldest waiting change, so nobody waits for or runs it. A repository branch
uses the queue when a landing gate (its full verification commands) is saved
for it on the Takode server; see \`takode land gate\`.

  takode land test <test file or directory>... | --no-tests | --full
      Check your branch before submitting, with the rerun-and-compare rule
      (flaky tests rerun once; failures that also happen on your base don't
      count). Name the tests that exercise your change: the gate's other steps
      (such as typecheck and format) run whole and its test step runs only
      those, usually in a minute or two. --no-tests runs only the other steps,
      for a change no test covers. --full runs the whole gate, holding a slot
      of the per-machine full-suite:<repo> pool (exits 3 if queued; rerun
      after the Resource Lease message); it can take 10+ minutes, so run it as
      a background or long-running command. The landing queue runs the full
      gate on every batch either way, and skips that run only for a lone
      change whose --full run tested exactly the tree it would push.
  takode land submit [q-N] [--preparation <id>] [--skip-test <reason>]
      Send your commits (merge-base with the remote branch to HEAD) to the
      queue. Needs a passing \`takode land test\` for this change. You don't
      wait for the landing: for a quest, hand it to Memory with
      \`takode board work-to-memory q-N --landing-entry <entry-id>\`.
  takode land run
      Escape hatch for a leader (or the owner of a waiting change) when the
      server cannot start a run: starts a landing runner on this machine.
  takode land status [--json]
  takode land withdraw <entry-id>
  takode land resume <entry-id>
      Put a bounced or withdrawn change back into this worktree (from the
      bundle the queue kept), with its bounce reason, to fix and resubmit.
  takode land gate [show|list|try|save|remove]
      Check, try out and save the branch's landing gate (\`takode land gate
      --help\`).

Common flags: --branch <name> overrides the session's port target branch.
Exit codes: 0 ok, 1 failure, 3 queued for a lease.`;

const QUEUED_EXIT_CODE = 3;
/** Short enough that a slot whose holder died (even by SIGKILL) frees itself soon; renewed while held. */
const TEST_LEASE_TTL_MS = 10 * 60_000;
const TEST_LEASE_RENEW_MS = 2 * 60_000;
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
  /** Test paths of a focused run; absent for a full-gate run (and records from before focused runs). */
  tests?: string[];
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
    case "resume":
      return landResume(base, flags);
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
  const full = flags.switches.has("--full");
  const noTests = flags.switches.has("--no-tests");
  const paths = flags.positional;
  if ([full, noTests, paths.length > 0].filter(Boolean).length !== 1) {
    console.log(testUsage(config));
    process.exitCode = 1;
    return;
  }
  // Focused runs are short, like the focused tests agents run while working, so only full runs take a pool slot.
  const selection = full ? undefined : await selectTests(ctx, config, paths);
  const slot = full ? await acquireFullSuiteSlot(base, ctx, "takode land test --full") : { release: async () => {} };
  if (!slot) return;
  const scratch = await mkdtemp(join(tmpdir(), "takode-land-test-"));
  const baselineDir = join(scratch, "baseline");
  let baselineReady = false;
  const log = (line: string) => console.log(line);
  let result: GateResult;
  try {
    console.log(
      `Gating ${change.head.slice(0, 10)} (base ${change.baseSha.slice(0, 10)}) with the landing gate saved for ${gate.key}${full ? "" : `, ${describeSelection(selection!)}`}.`,
    );
    const options: GateRunOptions = {
      dir: ctx.worktree,
      config,
      log,
      phase: (phase: string) => console.log(`[phase] ${phase}`),
      ...(selection ? { testSelection: selection } : {}),
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
  const summary = `${full ? "full gate" : describeSelection(selection!)}: ${describeGate(result)}`;
  const tests = selection ? Object.values(selection).flat() : undefined;
  const record: TestRecord = {
    ...change,
    base: change.baseSha,
    ok: result.ok,
    summary,
    at: Date.now(),
    ...(tests ? { tests } : {}),
  };
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

function testUsage(config: LandingGateConfig): string {
  const testSteps = config.steps.filter((step) => step.kind === "vitest").map((step) => step.name);
  const otherSteps = config.steps.filter((step) => step.kind !== "vitest").map((step) => step.name);
  return [
    "Choose what `takode land test` runs (exactly one of):",
    `  takode land test <test file or directory>...   the gate's other steps (${otherSteps.join(", ") || "none"}) plus only these tests in its test step${testSteps.length === 1 ? "" : "s"} (${testSteps.join(", ") || "none"})`,
    "  takode land test --no-tests                    the other steps only, for a change no test covers",
    "  takode land test --full                        the whole gate, for a change that could break tests anywhere",
    "Pick the tests that exercise what you changed. The landing queue runs the full gate on every batch either way.",
  ].join("\n");
}

/**
 * Map the named test paths (relative to the current directory) to the gate's
 * vitest steps whose directory contains them, as paths relative to that
 * directory. Every vitest step is in the result, with no paths when none of
 * the named ones is under it, so runGate skips it.
 */
async function selectTests(
  ctx: LandContext,
  config: LandingGateConfig,
  paths: string[],
): Promise<Record<string, string[]>> {
  const root = await realpath(ctx.worktree);
  const steps = config.steps
    .filter((step) => step.kind === "vitest")
    .map((step) => ({ name: step.name, dir: resolve(root, step.cwd ?? ".") }))
    // The deepest directory wins when test steps are nested.
    .sort((a, b) => b.dir.length - a.dir.length);
  const selection: Record<string, string[]> = Object.fromEntries(steps.map((step) => [step.name, []]));
  for (const path of paths) {
    if (steps.length === 0)
      throw new Error(
        `The gate for ${landingQueueKey(ctx.target)} has no vitest step to select tests in; run \`takode land test --no-tests\` or \`--full\`.`,
      );
    const absolute = await realpath(resolve(path)).catch(() => {
      throw new Error(`${path} does not exist. Name test files or directories, relative to where you run this.`);
    });
    const step = steps.find((candidate) => isInside(candidate.dir, absolute));
    if (!step)
      throw new Error(
        `${path} is not under the directory of the gate's test step${steps.length === 1 ? "" : "s"} (${steps.map((candidate) => relative(root, candidate.dir) || ".").join(", ")}).`,
      );
    selection[step.name]!.push(relative(step.dir, absolute) || ".");
  }
  return selection;
}

function isInside(dir: string, path: string): boolean {
  const rel = relative(dir, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function describeSelection(selection: Record<string, string[]>): string {
  const count = Object.values(selection).flat().length;
  return count === 0 ? "no tests (other steps only)" : `${count} chosen test path${count === 1 ? "" : "s"}`;
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
  const pool = `${FULL_SUITE_POOL_PREFIX}${ctx.target.repo}`;
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
    const tested = { patchId: record.patchId, tree: record.tree, summary: record.summary, at: record.at };
    preSubmitTest = record.tests ? { kind: "focused", ...tested, tests: record.tests } : { kind: "passed", ...tested };
  }
  const questId = flags.positional.find((arg) => /^q-\d+$/.test(arg));
  const bundleId = await uploadBundle(base, ctx, change.baseSha, change.head, commits);
  const submitted = await landingApi<{ entry: LandingEntry; ahead: number; activeRunId?: string }>(() =>
    apiPost(base, "/takode/land/submit", {
      target: ctx.target,
      baseCheckout: ctx.baseCheckout,
      ...(questId ? { questId } : {}),
      ...(flags.values.get("--preparation") ? { preparationId: flags.values.get("--preparation") } : {}),
      bundleId,
      base: change.baseSha,
      tip: change.head,
      commits,
      preSubmitTest,
    }),
  );
  const entry = submitted.entry;
  console.log(`Submitted ${commits.length} commit(s) as landing entry ${entry.id} for ${landingQueueKey(ctx.target)}.`);
  console.log(
    submitted.activeRunId
      ? `Landing run ${submitted.activeRunId} is under way; your change goes in the next run, together with everything else waiting then.`
      : submitted.ahead > 0
        ? `${submitted.ahead} change(s) are ahead of yours; the next run takes all of them.`
        : "Takode starts a landing run for it now.",
  );
  console.log("");
  console.log(
    questId
      ? `You don't wait for it. Write your Work note, then hand the quest on: \`takode board work-to-memory ${questId} --work-note <index> --landing-entry ${entry.id}\`. The quest lands by itself after Memory; if the change bounces, your leader decides who fixes it.`
      : "You don't wait for it: you get a Landing Queue message when it lands or bounces.",
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

/**
 * `takode land run`: the escape hatch. The server normally starts every landing
 * run itself; this starts the runner on the caller's machine instead, for a
 * leader (or the owner of a waiting change) when the server cannot.
 */
async function landRun(base: string, flags: Flags): Promise<void> {
  const ctx = await resolveContext(base, flags);
  if (flags.switches.has("--foreground")) return runAsRunner(base, ctx, flags.values.get("--log"));
  const { runner } = await landingApi<{ runner: { launchId: string; sessionId: string; token: string } }>(() =>
    apiPost(base, "/takode/land/runner", { target: ctx.target, baseCheckout: ctx.baseCheckout }),
  );
  const logDir = join(LANDING_HOME, "logs");
  await mkdir(logDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logPath = join(
    logDir,
    `${stamp}-${ctx.target.repo}-${ctx.target.branch.replace(/\//g, "_")}-${runner.launchId}.log`,
  );
  const handle = await open(logPath, "a");
  const child = spawn(
    process.execPath,
    [process.argv[1]!, "land", "run", "--foreground", "--branch", ctx.target.branch, "--log", logPath],
    {
      cwd: ctx.baseCheckout,
      detached: true,
      stdio: ["ignore", handle.fd, handle.fd],
      env: {
        ...process.env,
        COMPANION_PORT: String(new URL(base).port),
        COMPANION_SESSION_ID: runner.sessionId,
        COMPANION_AUTH_TOKEN: runner.token,
        TAKODE_API_PORT: "",
      },
    },
  );
  child.unref();
  await handle.close();
  console.log(`Started landing runner ${runner.launchId} on this machine (log: ${logPath}).`);
}

/** The runner process itself: one landing run for the queue, with the runner's own credentials. */
async function runAsRunner(base: string, ctx: LandContext, logPath: string | undefined): Promise<void> {
  const log = (line: string) => console.log(`${new Date().toISOString()} ${line}`);
  let runId = "";
  const runApi: LandingRunApi = {
    claim: async (target) => {
      const claim = await withRetry(() => apiPost(base, "/takode/land/runs", { target }));
      runId = (claim as { run?: { id: string } }).run?.id ?? runId;
      return claim as Awaited<ReturnType<LandingRunApi["claim"]>>;
    },
    heartbeat: async (id, phase, path) => {
      await apiPost(base, `/takode/land/runs/${id}/heartbeat`, { phase, logPath: path });
    },
    plan: async (id, plan) => {
      await withRetry(() => apiPost(base, `/takode/land/runs/${id}/plan`, { plan }));
    },
    finish: async (id, report) => {
      await withRetry(() => apiPost(base, `/takode/land/runs/${id}/finish`, { report }));
    },
    reconcile: async (id, pushed) => {
      await withRetry(() => apiPost(base, `/takode/land/runs/${id}/reconcile`, { pushed }));
    },
    fetchBundle: async (bundleId) => {
      const { data } = (await withRetry(() => apiGet(base, `/takode/land/runs/${runId}/bundles/${bundleId}`))) as {
        data: string;
      };
      return Buffer.from(data, "base64");
    },
    gate: async (target) => (await withRetry(() => savedGate(base, target)))?.config ?? null,
    // A heartbeat renews the queue's lease and fails once the queue no longer holds it.
    renewLease: async () => {
      await apiPost(base, `/takode/land/runs/${runId}/heartbeat`, {});
    },
  };
  const slug = `${ctx.target.repo}-${ctx.target.branch.replace(/[^A-Za-z0-9._-]/g, "_")}-${await shortHash(ctx.baseCheckout)}`;
  const landingDir = join(LANDING_HOME, "checkouts", slug);
  const lockPath = `${landingDir}.runner`;
  await takeOverLandingCheckout(lockPath, log);
  // A stopped runner (the server or a leader stopping it) stops its gate commands with it.
  const onStop = (signal: NodeJS.Signals) => {
    log(`Stopped by ${signal}; stopping the gate.`);
    stopActiveGateCommands("SIGTERM");
    void releaseLandingCheckout(lockPath).finally(() => process.exit(128 + (osConstants.signals[signal] ?? 15)));
  };
  for (const signal of STOP_SIGNALS) process.on(signal, onStop);
  try {
    const result = await runLanding({
      api: runApi,
      target: ctx.target,
      baseCheckout: ctx.baseCheckout,
      landingDir,
      scratchDir: join(LANDING_HOME, "scratch", slug),
      log,
      ...(logPath ? { logPath } : {}),
    });
    log(result.summary);
  } catch (error) {
    // The server takes the run back when it stops hearing from this runner.
    log(`The landing run could not finish reporting: ${(error as Error).message}`);
    process.exitCode = 1;
  } finally {
    for (const signal of STOP_SIGNALS) process.off(signal, onStop);
    await releaseLandingCheckout(lockPath);
  }
}

/**
 * One runner at a time works in a machine's landing checkout. When the server
 * gives up on a runner that is still alive (it stopped reporting) and starts
 * another here, the newer one stops the older one and its gate first.
 */
async function takeOverLandingCheckout(lockPath: string, log: (line: string) => void): Promise<void> {
  const previous = Number((await readFile(lockPath, "utf-8").catch(() => "")).trim());
  if (previous && previous !== process.pid && (await isLandingRunner(previous))) {
    log(`Stopping the earlier landing runner (pid ${previous}) that still works in this landing checkout.`);
    process.kill(previous, "SIGTERM");
    for (let i = 0; i < 30 && isAlive(previous); i++) await new Promise((resolve) => setTimeout(resolve, 500));
    if (isAlive(previous)) process.kill(previous, "SIGKILL");
  }
  await mkdir(dirname(lockPath), { recursive: true });
  await writeFile(lockPath, String(process.pid));
}

async function releaseLandingCheckout(lockPath: string): Promise<void> {
  const holder = Number((await readFile(lockPath, "utf-8").catch(() => "")).trim());
  if (holder === process.pid) await rm(lockPath, { force: true });
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Whether a live process is a landing runner, not an unrelated process that reused the PID. */
async function isLandingRunner(pid: number): Promise<boolean> {
  if (!isAlive(pid)) return false;
  return new Promise((resolvePromise) => {
    const ps = spawn("ps", ["-o", "args=", "-p", String(pid)], { stdio: ["ignore", "pipe", "ignore"] });
    let args = "";
    ps.stdout.on("data", (chunk) => (args += chunk));
    ps.on("error", () => resolvePromise(false));
    ps.on("close", () => resolvePromise(/\bland run --foreground\b/.test(args)));
  });
}

async function shortHash(text: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(text).digest("hex").slice(0, 8);
}

/**
 * Retry calls that must reach the server, such as a runner's final report
 * across a coordinator restart. A host's API proxy answers 502 while the
 * coordinator is away, which the CLI sees as "Bad Gateway".
 */
async function withRetry<T>(call: () => Promise<T>, attempts = 12): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      const message = (error as Error).message;
      const transient =
        /fetch failed|ECONNREFUSED|ECONNRESET|socket|HTTP 5\d\d|unreachable|Bad Gateway|Service Unavailable|Gateway Timeout|Internal Server Error/i.test(
          message,
        );
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
  const launchWhere = (launch: NonNullable<LandingQueueSnapshot["launch"]>) =>
    `${launch.hostId ? `host ${launch.hostId}` : "the coordinator's machine"}, ${launch.baseCheckout}${launch.startedBySessionId ? ", started by hand" : ""}`;
  if (snapshot.activeRun) {
    const run = snapshot.activeRun;
    console.log(
      `  running: ${run.id}, ${run.entryIds.length} entr${run.entryIds.length === 1 ? "y" : "ies"}, ${age(run.startedAt)} so far, phase: ${run.phase}${run.logPath ? `, log ${run.logPath}` : ""}${snapshot.launch?.runId === run.id ? ` (${launchWhere(snapshot.launch)})` : ""}`,
    );
  } else if (snapshot.launch && !snapshot.launch.endedAt) {
    console.log(`  starting a runner: ${snapshot.launch.id} on ${launchWhere(snapshot.launch)}`);
  } else if (snapshot.queueLease === "waiting") {
    console.log(`  waiting for ${snapshot.leaseKey} (a classic port holds it); the run starts when it is free`);
  }
  if (snapshot.launchProblem)
    console.log(
      `  problem: ${snapshot.launchProblem.message} Next attempt ${snapshot.launchProblem.retryAt > now ? `in ${Math.ceil((snapshot.launchProblem.retryAt - now) / 60_000)}m` : "now"}.`,
    );
  for (const run of snapshot.unreconciled)
    console.log(`  interrupted, awaiting the next run: ${run.id} (${run.summary ?? ""})`);
  const label = (entry: LandingEntry) =>
    `${entry.id} #${entry.sessionNum ?? entry.sessionId.slice(0, 8)}${entry.questId ? ` ${entry.questId}` : ""} ${entry.commits.length} commit(s)`;
  const waiting = snapshot.entries.filter((entry) => entry.state === "pending" || entry.state === "running");
  console.log(waiting.length ? "  waiting:" : "  nothing waiting");
  for (const entry of waiting)
    console.log(
      `    ${label(entry)} ${entry.state}, submitted ${age(entry.submittedAt)} ago${entry.reason ? ` (last attempt: ${entry.reason.split("\n")[0]})` : ""}`,
    );
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

/**
 * Put a bounced (or withdrawn) change back into this worktree from the bundle
 * the queue kept, so whoever fixes it starts from exactly what was submitted.
 */
async function landResume(base: string, flags: Flags): Promise<void> {
  const id = flags.positional[0];
  if (!id || !/^le-[0-9a-f]{8}$/.test(id)) throw new Error("Usage: takode land resume <entry-id>");
  const { entry } = await landingApi<{ entry: LandingEntry }>(() => apiGet(base, `/takode/land/entries/${id}`));
  if (entry.state !== "bounced" && entry.state !== "withdrawn")
    throw new Error(`Entry ${entry.id} is ${entry.state}; only a bounced or withdrawn change is resumed.`);
  const ctx = await resolveContext(base, { ...flags, values: new Map([["--branch", entry.target.branch]]) });
  await assertClean(ctx.worktree);
  const head = await git(ctx.worktree, ["rev-parse", "HEAD"]);
  if (head !== entry.tip && !(await isAncestor(ctx.worktree, head, ctx.remoteRef)))
    throw new Error(
      `This worktree has commits that are not on origin/${entry.target.branch}; commit them to another branch or use a clean worktree first.`,
    );
  const { data } = (await apiGet(base, `/bundles/${encodeURIComponent(entry.bundleId)}`)) as { data: string };
  const dir = await mkdtemp(join(tmpdir(), "takode-land-resume-"));
  try {
    const file = join(dir, "commits.bundle");
    await writeFile(file, Buffer.from(data, "base64"));
    // The bundle needs its base, which is on the remote branch's history.
    await git(ctx.worktree, ["fetch", "--quiet", file, `+${entry.tip}:refs/takode/resume/${entry.id}`]).catch(
      async () => {
        await git(ctx.worktree, ["fetch", "--quiet", "--no-tags", file]);
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  await git(ctx.worktree, ["reset", "--quiet", "--hard", entry.tip]);
  await git(ctx.worktree, ["update-ref", "-d", `refs/takode/resume/${entry.id}`]).catch(() => undefined);
  console.log(
    `Your worktree now has the ${entry.commits.length} commit(s) of ${entry.id} (tip ${entry.tip.slice(0, 10)}).`,
  );
  console.log(`It ${entry.state === "bounced" ? "bounced" : "was withdrawn"}: ${entry.reason ?? "no reason recorded"}`);
  if (entry.details) console.log(["", "```", entry.details.slice(-3000), "```"].join("\n"));
  console.log("");
  console.log(
    `Next: rebase onto origin/${entry.target.branch}, fix it, rerun \`takode land test\` and \`takode land submit${entry.questId ? ` ${entry.questId}` : ""}\`.`,
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
      a slot of the per-machine full-suite:<repo> pool like \`takode land test --full\`
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
