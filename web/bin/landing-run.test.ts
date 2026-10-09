import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LandingEntry, LandingGateConfig, LandingPushPlan, LandingRunReport } from "../shared/landing-queue.js";
import { git } from "./landing-git.js";
import { runLanding, type LandingRunApi } from "./landing-run.js";

// Every test drives dozens of real git processes in disposable repositories.
vi.setConfig({ testTimeout: 60_000 });

/**
 * Real Git end to end: a bare "origin", the machine's base checkout cloned from
 * it, and worker clones whose commits travel as bundles, exactly as `takode
 * land submit` sends them. The gate is a shell script that fails when a file
 * named `broken` exists and counts its runs, so tests can see what was gated.
 */
describe("landing run", () => {
  let root: string;
  let origin: string;
  let base: string;
  let worker: string;
  let gateCount: string;
  let bundles: Map<string, Buffer>;
  let plans: LandingPushPlan[];
  let reports: LandingRunReport[];
  let beforePush: (() => Promise<void>) | undefined;
  let savedGate: LandingGateConfig | null;
  let gateError: Error | undefined;
  let nextEntry = 0;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "landing-run-"));
    origin = join(root, "origin.git");
    base = join(root, "base");
    worker = join(root, "worker");
    gateCount = join(root, "gate-count");
    bundles = new Map();
    plans = [];
    reports = [];
    beforePush = undefined;
    // The gate saved on the Takode server for the target; the run asks for it, not the repository.
    savedGate = { version: 1, steps: [{ name: "check", run: ["sh", "gate.sh"] }] };
    gateError = undefined;
    await git(root, ["init", "--quiet", "--bare", "-b", "main", origin]);
    const seed = join(root, "seed");
    await git(root, ["init", "--quiet", "-b", "main", seed]);
    await configure(seed);
    await writeFile(
      join(seed, "gate.sh"),
      'echo run >> "$GATE_COUNT"\nif [ -e broken ]; then echo "broken file present"; exit 1; fi\n',
    );
    await git(seed, ["add", "gate.sh"]);
    await writeFile(join(seed, "shared.txt"), "one\ntwo\nthree\nfour\nfive\nsix\n");
    await git(seed, ["add", "shared.txt"]);
    await git(seed, ["commit", "--quiet", "-m", "seed"]);
    await git(seed, ["push", "--quiet", origin, "main"]);
    await git(root, ["clone", "--quiet", origin, base]);
    await configure(base);
    await git(root, ["clone", "--quiet", origin, worker]);
    await configure(worker);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function configure(dir: string) {
    await git(dir, ["config", "user.name", "Fixture"]);
    await git(dir, ["config", "user.email", "fixture@example.invalid"]);
    await git(dir, ["config", "core.hooksPath", join(root, "no-hooks")]);
  }

  /** Make an entry from commits on a fresh worker branch based on origin/main. */
  async function entry(files: Record<string, string>[], options: { from?: string } = {}): Promise<LandingEntry> {
    const id = `le-0000000${nextEntry++}`;
    await git(worker, ["fetch", "--quiet", "origin"]);
    await git(worker, ["checkout", "--quiet", "-B", id, options.from ?? "origin/main"]);
    const start = await git(worker, ["rev-parse", "HEAD"]);
    const commits = [];
    for (const [i, change] of files.entries()) {
      for (const [path, contents] of Object.entries(change)) {
        await writeFile(join(worker, path), contents);
        await git(worker, ["add", path]);
      }
      await git(worker, ["commit", "--quiet", "-m", `${id} commit ${i}`]);
      commits.push({ sha: await git(worker, ["rev-parse", "HEAD"]), subject: `${id} commit ${i}` });
    }
    const file = join(root, `${id}.bundle`);
    await git(worker, ["bundle", "create", "--quiet", file, `${start}..HEAD`]);
    bundles.set(`b-${id.slice(3)}`, await readFile(file));
    return {
      id,
      key: "repo:main",
      target: { repo: "repo", branch: "main" },
      sessionId: `session-${id}`,
      bundleId: `b-${id.slice(3)}`,
      base: start,
      tip: commits.at(-1)!.sha,
      commits,
      preSubmitTest: { kind: "skipped", reason: "fixture" },
      submittedAt: Date.now(),
      state: "running",
    };
  }

  async function land(entries: LandingEntry[]) {
    const api: LandingRunApi = {
      claim: async () => ({
        run: {
          id: "lr-00000001",
          key: "repo:main",
          target: { repo: "repo", branch: "main" },
          ownerSessionId: "lander",
          startedAt: Date.now(),
          heartbeatAt: Date.now(),
          phase: "starting",
          entryIds: entries.map((item) => item.id),
          state: "running",
        },
        entries,
        unreconciled: [],
      }),
      heartbeat: async () => undefined,
      plan: async (_runId, plan) => {
        plans.push(plan);
        await beforePush?.();
      },
      finish: async (_runId, report) => {
        reports.push(report);
      },
      reconcile: async () => undefined,
      fetchBundle: async (id) => bundles.get(id)!,
      gate: async () => {
        if (gateError) throw gateError;
        return savedGate;
      },
      renewLease: async () => undefined,
    };
    const result = await runLanding({
      api,
      target: { repo: "repo", branch: "main" },
      baseCheckout: base,
      landingDir: join(root, "landing"),
      scratchDir: join(root, "scratch"),
      log: () => undefined,
      env: { ...process.env, GATE_COUNT: gateCount },
    });
    return { result, report: reports.at(-1)! };
  }

  const gateRuns = async () => (await readFile(gateCount, "utf-8").catch(() => "")).split("\n").filter(Boolean).length;
  const outcome = (report: LandingRunReport, item: LandingEntry) =>
    report.outcomes.find((candidate) => candidate.entryId === item.id)!;
  const originTip = () => git(origin, ["rev-parse", "main"]);

  it("lands a batch with one gate run and pushes exactly the gated stack", async () => {
    const first = await entry([{ "a.txt": "a\n" }]);
    const second = await entry([{ "b.txt": "b\n" }, { "b.txt": "b2\n" }]);
    // Both edit shared.txt in different places: a clean merge whose target blobs differ.
    const third = await entry([{ "shared.txt": "one\ntwo\nthree\nfour\nfive\nSIX\n" }]);
    const fourth = await entry([{ "shared.txt": "ONE\ntwo\nthree\nfour\nfive\nsix\n" }]);
    const { report } = await land([first, second, third, fourth]);

    expect(report.outcomes.map((item) => item.outcome)).toEqual(["landed", "landed", "landed", "landed"]);
    expect(await gateRuns()).toBe(1);
    const tip = await originTip();
    expect(report.pushedTip).toBe(tip);
    expect(plans[0]!.tip).toBe(tip);
    // The base checkout was fast-forwarded to the pushed commit.
    expect(await git(base, ["rev-parse", "HEAD"])).toBe(tip);
    const fourthLanded = outcome(report, fourth);
    expect(fourthLanded.outcome === "landed" && fourthLanded.mapping[0]!.integrated).toBe(true);
    const secondLanded = outcome(report, second);
    expect(secondLanded.outcome === "landed" && secondLanded.mapping.map((commit) => commit.source)).toEqual(
      second.commits.map((commit) => commit.sha),
    );
    expect(await git(base, ["show", "HEAD:shared.txt"])).toBe("ONE\ntwo\nthree\nfour\nfive\nSIX");
  });

  it("bounces the change that breaks the gate and lands the rest after re-gating them", async () => {
    const first = await entry([{ "a.txt": "a\n" }]);
    const culprit = await entry([{ broken: "x\n" }]);
    const third = await entry([{ "c.txt": "c\n" }]);
    const { report } = await land([first, culprit, third]);

    expect(outcome(report, first).outcome).toBe("landed");
    expect(outcome(report, third).outcome).toBe("landed");
    const bounced = outcome(report, culprit);
    expect(bounced.outcome).toBe("bounced");
    expect(bounced.outcome === "bounced" && bounced.details).toContain("broken file present");
    expect(await git(origin, ["show", "main:c.txt"])).toBe("c");
    await expect(git(origin, ["show", "main:broken"])).rejects.toThrow();
  });

  it("bounces a conflicting change without blocking the others", async () => {
    const first = await entry([{ "shared.txt": "first\n" }]);
    const second = await entry([{ "shared.txt": "second\n" }]);
    const third = await entry([{ "c.txt": "c\n" }]);
    const { report } = await land([first, second, third]);
    expect(report.outcomes.map((item) => item.outcome)).toEqual(["landed", "bounced", "landed"]);
    const bounced = outcome(report, second);
    expect(bounced.outcome === "bounced" && bounced.reason).toContain("conflicts in shared.txt");
  });

  it("reuses a pre-submit run of the identical tree instead of gating again", async () => {
    const only = await entry([{ "a.txt": "a\n" }]);
    const tree = await git(worker, ["rev-parse", "HEAD^{tree}"]);
    only.preSubmitTest = { kind: "passed", patchId: "p", tree, summary: "no new failures", at: Date.now() };
    const { report } = await land([only]);
    expect(outcome(report, only).outcome).toBe("landed");
    expect(await gateRuns()).toBe(0);
    expect(await git(origin, ["rev-parse", "main^{tree}"])).toBe(tree);
  });

  it("gates a lone change whose pre-submit run was focused, even on the identical tree", async () => {
    // A focused run (`takode land test <paths>`) ran only chosen tests, so it never stands in for the gate.
    const only = await entry([{ "a.txt": "a\n" }]);
    const tree = await git(worker, ["rev-parse", "HEAD^{tree}"]);
    only.preSubmitTest = { kind: "focused", patchId: "p", tree, tests: ["a.test.ts"], summary: "ok", at: Date.now() };
    const { report } = await land([only]);
    expect(outcome(report, only).outcome).toBe("landed");
    expect(await gateRuns()).toBe(1);
  });

  it("requeues the batch when the remote moved before the push", async () => {
    const only = await entry([{ "a.txt": "a\n" }]);
    const intruder = await entry([{ "z.txt": "z\n" }]);
    beforePush = async () => {
      await git(worker, ["push", "--quiet", "origin", `${intruder.tip}:refs/heads/main`]);
    };
    const { report } = await land([only]);
    const requeued = outcome(report, only);
    expect(requeued.outcome).toBe("requeue");
    expect(report.pushedTip).toBeUndefined();
    expect(await originTip()).toBe(intruder.tip);
  });

  it("bounces every entry without gating when the target no longer has a saved gate", async () => {
    // Opting out (removing the saved gate) while changes wait sends them back to the classic flow.
    const only = await entry([{ "a.txt": "a\n" }]);
    const before = await originTip();
    savedGate = null;
    const { report } = await land([only]);
    const bounced = outcome(report, only);
    expect(bounced.outcome === "bounced" && bounced.reason).toContain("No landing gate is saved for repo:main");
    expect(await gateRuns()).toBe(0);
    expect(await originTip()).toBe(before);

    // A server that cannot answer for gates (older build) bounces with its explanation too.
    const again = await entry([{ "b.txt": "b\n" }]);
    gateError = new Error("This Takode server does not store landing gates yet");
    const failed = outcome((await land([again])).report, again);
    expect(failed.outcome === "bounced" && failed.reason).toContain("does not store landing gates yet");
  });

  it("bounces a change whose base is not on the remote branch", async () => {
    await git(worker, ["checkout", "--quiet", "-B", "unpublished", "origin/main"]);
    await writeFile(join(worker, "local.txt"), "local\n");
    await git(worker, ["add", "local.txt"]);
    await git(worker, ["commit", "--quiet", "-m", "unpublished base"]);
    // Make the unpublished commit known to the base repository, as a same-machine worktree would.
    await git(base, ["fetch", "--quiet", worker, "unpublished:refs/heads/unpublished"]);
    const stacked = await entry([{ "b.txt": "b\n" }], { from: "unpublished" });
    const { report } = await land([stacked]);
    const bounced = outcome(report, stacked);
    expect(bounced.outcome === "bounced" && bounced.reason).toContain("is not on origin/main");
  });
});
