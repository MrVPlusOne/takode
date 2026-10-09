/**
 * The landing gate: the repository's declared full verification, run with the
 * rerun-and-compare rule shared by pre-submit runs (`takode land test`) and
 * landing runs. A failing test file is rerun once; tests that pass on rerun are
 * flaky. Tests that still fail are run on the baseline commit, and failures
 * that also happen there are pre-existing. Only the remaining new failures fail
 * the gate.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { git } from "./landing-git.js";

export const LANDING_GATE_FILE = ".takode/landing-gate.json";

export interface LandingGateStep {
  name: string;
  /** Directory relative to the checkout root. */
  cwd?: string;
  run: string[];
  /** `vitest` steps report per-test failures and can rerun single files. */
  kind?: "command" | "vitest";
}

export interface LandingGateConfig {
  version: 1;
  /** Runs before the steps in every checkout the gate uses (e.g. a frozen dependency install). */
  install?: { cwd?: string; run: string[] };
  steps: LandingGateStep[];
}

export interface StepResult {
  ok: boolean;
  /** Last lines of the step's output. */
  tail: string;
  /** Normalized output lines, for comparing a command step's failure with the baseline's. */
  lines: string[];
  /** Failing test IDs (`file > test name`) for a vitest step whose report was readable. */
  failures?: string[];
}

/** What a later probe needs to check whether a commit still has a gate failure. */
export interface GateProbe {
  step: LandingGateStep;
  files?: string[];
  ids?: string[];
  /** Normalized baseline output lines, for command steps. */
  baseLines?: string[];
}

export interface GateResult {
  ok: boolean;
  failedStep?: string;
  newFailures: string[];
  flaky: string[];
  preexisting: string[];
  /** Failing output for the change's owner. */
  excerpt: string;
  probe?: GateProbe;
  /** Seconds per step, for logs and overhead measurements. */
  timings: Record<string, number>;
}

export interface GateRunOptions {
  dir: string;
  config: LandingGateConfig;
  /** Lazily prepare a checkout of the baseline commit (with dependencies installed). */
  baselineDir: () => Promise<string>;
  log: (line: string) => void;
  phase?: (phase: string) => void;
  env?: NodeJS.ProcessEnv;
}

export function parseGateConfig(text: string): LandingGateConfig {
  const raw = JSON.parse(text) as Partial<LandingGateConfig>;
  const isCommand = (run: unknown) =>
    Array.isArray(run) && run.length > 0 && run.every((part) => typeof part === "string" && part);
  if (raw.version !== 1 || !Array.isArray(raw.steps) || raw.steps.length === 0)
    throw new Error(`${LANDING_GATE_FILE} needs version 1 and at least one step.`);
  for (const step of raw.steps) {
    if (!step || typeof step.name !== "string" || !isCommand(step.run))
      throw new Error(`${LANDING_GATE_FILE}: every step needs a name and a run command array.`);
    if (step.kind !== undefined && step.kind !== "command" && step.kind !== "vitest")
      throw new Error(`${LANDING_GATE_FILE}: step kind must be command or vitest.`);
  }
  if (raw.install !== undefined && !isCommand(raw.install.run))
    throw new Error(`${LANDING_GATE_FILE}: install needs a run command array.`);
  return raw as LandingGateConfig;
}

/** The gate declared at a commit, or null when the repository declares none there. */
export async function readGateConfigAt(repoDir: string, commit: string): Promise<LandingGateConfig | null> {
  const text = await git(repoDir, ["show", `${commit}:${LANDING_GATE_FILE}`]).catch(() => null);
  return text === null ? null : parseGateConfig(text);
}

export async function installDependencies(dir: string, config: LandingGateConfig, options: GateRunOptions) {
  if (!config.install) return;
  const result = await runCommand(dir, config.install.cwd, config.install.run, options);
  if (!result.ok) throw new Error(`Dependency install failed in ${dir}:\n${result.tail}`);
}

export async function runGate(options: GateRunOptions): Promise<GateResult> {
  const result: GateResult = { ok: true, newFailures: [], flaky: [], preexisting: [], excerpt: "", timings: {} };
  const timed = async <T>(name: string, fn: () => Promise<T>) => {
    const start = Date.now();
    try {
      return await fn();
    } finally {
      result.timings[name] = (result.timings[name] ?? 0) + (Date.now() - start) / 1000;
    }
  };
  await timed("install", () => installDependencies(options.dir, options.config, options));
  for (const step of options.config.steps) {
    options.phase?.(`gate: ${step.name}`);
    const first = await timed(step.name, () => runStep(options.dir, step, options));
    if (first.ok) continue;
    options.log(`Step ${step.name} failed; checking whether the failure is new.`);
    if (step.kind === "vitest" && first.failures?.length) {
      const files = filesOf(first.failures);
      options.phase?.(`gate: rerunning ${files.length} failing test file(s)`);
      const rerun = await timed(`${step.name} rerun`, () => runStep(options.dir, step, options, files));
      const still = rerun.failures ?? (rerun.ok ? [] : first.failures);
      result.flaky.push(...first.failures.filter((id) => !still.includes(id)));
      if (still.length === 0) continue;
      options.phase?.(`gate: checking ${filesOf(still).length} file(s) on the baseline`);
      const baseDir = await timed("baseline checkout", options.baselineDir);
      const base = await timed(`${step.name} baseline`, () => runStep(baseDir, step, options, filesOf(still)));
      const baseFailures = new Set(base.failures ?? (base.ok ? [] : still));
      const pre = still.filter((id) => baseFailures.has(id));
      let fresh = still.filter((id) => !baseFailures.has(id));
      result.preexisting.push(...pre);
      if (fresh.length > 0) {
        // Passing on the base while failing here may still be load flakiness: blame a
        // test only if it fails once more, in a run of just its own files.
        options.phase?.(`gate: confirming ${fresh.length} new failure(s)`);
        const confirm = await timed(`${step.name} confirm`, () => runStep(options.dir, step, options, filesOf(fresh)));
        const confirmed = new Set(confirm.failures ?? (confirm.ok ? [] : fresh));
        result.flaky.push(...fresh.filter((id) => !confirmed.has(id)));
        fresh = fresh.filter((id) => confirmed.has(id));
      }
      if (fresh.length === 0) continue;
      return fail(result, step, fresh, rerun.tail, { step, files: filesOf(fresh), ids: fresh });
    }
    if (step.kind === "vitest" && first.failures === undefined) {
      // Without a readable report the run itself broke (for example the runner could not
      // start); never excuse that by comparing with a baseline that may break the same way.
      return fail(result, step, [`${step.name} (no test report)`], first.tail, { step });
    }
    if (step.kind === "vitest") {
      // A readable report with no failing test means only unhandled errors: rerun the whole step once.
      const rerun = await timed(`${step.name} rerun`, () => runStep(options.dir, step, options));
      if (rerun.ok) {
        result.flaky.push(`${step.name} (whole step)`);
        continue;
      }
    }
    const baseDir = await timed("baseline checkout", options.baselineDir);
    const base = await timed(`${step.name} baseline`, () => runStep(baseDir, step, options));
    const fresh = base.ok ? first.lines : newLines(first.lines, base.lines);
    if (!base.ok && fresh.length === 0) {
      result.preexisting.push(`${step.name} (same failure output on the baseline)`);
      continue;
    }
    return fail(result, step, [step.name], first.tail, { step, baseLines: base.ok ? [] : base.lines });
  }
  return result;
}

/** Whether a checkout still shows the failure a gate run found. */
export async function probeFails(dir: string, probe: GateProbe, options: GateRunOptions): Promise<boolean> {
  const result = await runStep(dir, probe.step, options, probe.files);
  if (result.ok) return false;
  if (probe.ids) return (result.failures ?? probe.ids).some((id) => probe.ids!.includes(id));
  return newLines(result.lines, probe.baseLines ?? []).length > 0;
}

function fail(result: GateResult, step: LandingGateStep, fresh: string[], tail: string, probe: GateProbe) {
  return { ...result, ok: false, failedStep: step.name, newFailures: fresh, excerpt: tail, probe };
}

export async function runStep(
  dir: string,
  step: LandingGateStep,
  options: GateRunOptions,
  files?: string[],
): Promise<StepResult> {
  if (step.kind !== "vitest") return runCommand(dir, step.cwd, [...step.run, ...(files ?? [])], options);
  const reportDir = await mkdtemp(join(tmpdir(), "takode-landing-vitest-"));
  const report = join(reportDir, "report.json");
  try {
    const result = await runCommand(
      dir,
      step.cwd,
      [...step.run, "--reporter=dot", "--reporter=json", `--outputFile=${report}`, ...(files ?? [])],
      options,
    );
    const failures = await readVitestFailures(report, resolve(dir, step.cwd ?? "."));
    return failures ? { ...result, failures } : result;
  } finally {
    await rm(reportDir, { recursive: true, force: true });
  }
}

/** Failing test IDs from a Vitest JSON report, or undefined when the report is missing or unreadable. */
export async function readVitestFailures(reportPath: string, stepDir: string): Promise<string[] | undefined> {
  try {
    const report = JSON.parse(await readFile(reportPath, "utf-8")) as {
      testResults?: { name: string; status: string; assertionResults?: { fullName: string; status: string }[] }[];
    };
    if (!Array.isArray(report.testResults)) return undefined;
    const failures: string[] = [];
    for (const file of report.testResults) {
      const name = relative(stepDir, file.name);
      const failed = (file.assertionResults ?? []).filter((test) => test.status === "failed");
      for (const test of failed) failures.push(`${name} > ${test.fullName}`);
      if (failed.length === 0 && file.status === "failed") failures.push(`${name} > (file)`);
    }
    return failures;
  } catch {
    return undefined;
  }
}

function filesOf(ids: string[]): string[] {
  return [...new Set(ids.map((id) => id.split(" > ")[0]!))];
}

/** Lines of `candidate` not in `base`, after normalizing numbers and blank lines. */
function newLines(candidate: string[], base: string[]): string[] {
  const known = new Set(base);
  return candidate.filter((line) => !known.has(line));
}

function normalize(output: string, dir: string): string[] {
  return output
    .split("\n")
    .map((line) =>
      line
        .split(dir)
        .join("<checkout>")
        // biome-ignore lint/suspicious/noControlCharactersInRegex: strips terminal colors
        .replace(/\u001b\[[0-9;]*m/g, "")
        .replace(/\d+/g, "#")
        .trim(),
    )
    .filter(Boolean);
}

async function runCommand(
  dir: string,
  cwd: string | undefined,
  argv: string[],
  options: Pick<GateRunOptions, "log" | "env">,
): Promise<StepResult> {
  const workdir = resolve(dir, cwd ?? ".");
  options.log(`$ (${relative(dir, workdir) || "."}) ${argv.join(" ")}`);
  return new Promise((resolvePromise, reject) => {
    const child = spawn(argv[0]!, argv.slice(1), {
      cwd: workdir,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const collect = (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      // Keep memory bounded on very chatty steps; the log has everything.
      if (output.length > 4_000_000) output = output.slice(-2_000_000);
      for (const line of text.split("\n")) if (line) options.log(`  ${line}`);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", reject);
    child.on("close", (code) => {
      const lines = output.split("\n");
      resolvePromise({
        ok: code === 0,
        tail: lines.slice(-80).join("\n"),
        lines: code === 0 ? [] : normalize(output, dir),
      });
    });
  });
}
