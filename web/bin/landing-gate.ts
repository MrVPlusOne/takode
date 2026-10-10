/**
 * The landing gate: the repository's declared full verification, run with the
 * rerun-and-compare rule shared by pre-submit runs (`takode land test`) and
 * landing runs. A failing test file is rerun once; tests that pass on rerun are
 * flaky. Tests that still fail are run on the baseline commit, and failures
 * that also happen there are pre-existing. Only the remaining new failures fail
 * the gate. Vitest's unhandled errors (a leaked timer firing after teardown,
 * an unhandled rejection) take part in the same rule: each one counts as a
 * failure of the test file Vitest attributes it to, or of the whole step when
 * it names none. A focused pre-submit run narrows the Vitest steps to the tests
 * the worker chose and keeps every other step whole.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import type { LandingGateConfig, LandingGateStep } from "../shared/landing-queue.js";

export type { LandingGateConfig, LandingGateStep };

export interface StepResult {
  ok: boolean;
  /** Last lines of the step's output. */
  tail: string;
  /** Normalized output lines, for comparing a command step's failure with the baseline's. */
  lines: string[];
  /** Raw output of a failed command (bounded), for reading Vitest's unhandled errors. */
  output?: string;
  /**
   * Failing test IDs (`file > test name`) for a vitest step whose report was readable, followed by
   * its unhandled errors (`file > (unhandled) Error: message`, or `(unhandled) Error: message`
   * when Vitest names no test file).
   */
  failures?: string[];
  /** Test files the vitest step's report lists. */
  testFiles?: number;
}

/** What a later probe needs to check whether a commit still has a gate failure. */
export interface GateProbe {
  step: LandingGateStep;
  /** Test files to run; absent for the whole step (an unhandled error that names no file). */
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
  /**
   * Lazily prepare a checkout of the baseline commit (with dependencies installed).
   * Without one (trying out a draft gate), failures that remain after the rerun fail the gate.
   */
  baselineDir?: () => Promise<string>;
  /**
   * Run only these test paths (relative to the step's directory) in the named
   * vitest steps, and skip vitest steps not named or named with none. Other
   * steps run whole. Without it every step runs whole (the full gate).
   */
  testSelection?: Record<string, string[]>;
  log: (line: string) => void;
  phase?: (phase: string) => void;
  env?: NodeJS.ProcessEnv;
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
    const selected = options.testSelection && step.kind === "vitest" ? (options.testSelection[step.name] ?? []) : null;
    if (selected?.length === 0) {
      options.log(`Skipping step ${step.name}: no tests selected for it.`);
      continue;
    }
    options.phase?.(`gate: ${step.name}`);
    const first = await timed(step.name, () => runStep(options.dir, step, options, selected ?? undefined));
    if (selected && first.testFiles === 0) {
      // A mistyped or non-test path must not pass as "no failures" (nor as a failure the base shares).
      return fail(result, step, [`${step.name} (no test files match ${selected.join(", ")})`], first.tail, { step });
    }
    if (first.ok) continue;
    options.log(`Step ${step.name} failed; checking whether the failure is new.`);
    if (step.kind === "vitest" && first.failures?.length) {
      // Rerun, baseline and confirm runs cover just the failing files, or the whole
      // step (or selection) when an unhandled error names no file.
      const scopeOf = (ids: string[]) => rerunScope(ids, selected);
      const scope = scopeOf(first.failures);
      options.phase?.(`gate: rerunning ${describeScope(scope)}`);
      const rerun = await timed(`${step.name} rerun`, () => runStep(options.dir, step, options, scope));
      const still = rerun.failures ?? (rerun.ok ? [] : first.failures);
      result.flaky.push(...first.failures.filter((id) => !still.includes(id)));
      if (still.length === 0) continue;
      if (!options.baselineDir)
        return fail(result, step, still, rerun.tail, { step, files: scopeOf(still), ids: still });
      options.phase?.(`gate: checking ${describeScope(scopeOf(still))} on the baseline`);
      const baseDir = await timed("baseline checkout", options.baselineDir);
      const base = await timed(`${step.name} baseline`, () => runStep(baseDir, step, options, scopeOf(still)));
      const baseFailures = new Set(base.failures ?? (base.ok ? [] : still));
      const pre = still.filter((id) => baseFailures.has(id));
      let fresh = still.filter((id) => !baseFailures.has(id));
      result.preexisting.push(...pre);
      if (fresh.length > 0) {
        // Passing on the base while failing here may still be load flakiness: blame a
        // test only if it fails once more, in a run of just its own files.
        options.phase?.(`gate: confirming ${fresh.length} new failure(s)`);
        const confirm = await timed(`${step.name} confirm`, () => runStep(options.dir, step, options, scopeOf(fresh)));
        const confirmed = new Set(confirm.failures ?? (confirm.ok ? [] : fresh));
        result.flaky.push(...fresh.filter((id) => !confirmed.has(id)));
        fresh = fresh.filter((id) => confirmed.has(id));
      }
      if (fresh.length === 0) continue;
      return fail(result, step, fresh, rerun.tail, { step, files: scopeOf(fresh), ids: fresh });
    }
    if (step.kind === "vitest" && first.failures === undefined) {
      // Without a readable report the run itself broke (for example the runner could not
      // start); never excuse that by comparing with a baseline that may break the same way.
      return fail(result, step, [`${step.name} (no test report)`], first.tail, { step });
    }
    if (step.kind === "vitest") {
      // A readable report, no failing test and no recognizable unhandled error: rerun the whole step (or selection) once.
      const rerun = await timed(`${step.name} rerun`, () => runStep(options.dir, step, options, selected ?? undefined));
      if (rerun.ok) {
        result.flaky.push(`${step.name} (whole step)`);
        continue;
      }
    }
    if (!options.baselineDir) return fail(result, step, [step.name], first.tail, { step, baseLines: [] });
    const baseDir = await timed("baseline checkout", options.baselineDir);
    const base = await timed(`${step.name} baseline`, () => runStep(baseDir, step, options, selected ?? undefined));
    const fresh = base.ok ? first.lines : newLines(first.lines, base.lines);
    if (!base.ok && fresh.length === 0) {
      result.preexisting.push(`${step.name} (same failure output on the baseline)`);
      continue;
    }
    return fail(result, step, [step.name], first.tail, { step, baseLines: base.ok ? [] : base.lines });
  }
  return result;
}

const activeCommands = new Set<ChildProcess>();

/** Stop every gate command still running in this process, with its whole process group. */
export function stopActiveGateCommands(signal: NodeJS.Signals = "SIGTERM"): void {
  for (const child of activeCommands) {
    try {
      if (child.pid) process.kill(-child.pid, signal);
    } catch {
      child.kill(signal);
    }
  }
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
  const reportPath = join(reportDir, "report.json");
  try {
    const result = await runCommand(
      dir,
      step.cwd,
      [...step.run, "--reporter=dot", "--reporter=json", `--outputFile=${reportPath}`, ...(files ?? [])],
      options,
    );
    const report = await readVitestReport(reportPath, await resolvedPath(resolve(dir, step.cwd ?? ".")));
    if (!report) return result;
    return { ...result, ...report, failures: [...report.failures, ...unhandledErrorIds(result.output ?? "")] };
  } finally {
    await rm(reportDir, { recursive: true, force: true });
  }
}

/** Failing test IDs and test file count from a Vitest JSON report, or undefined when it is missing or unreadable. */
export async function readVitestReport(
  reportPath: string,
  stepDir: string,
): Promise<{ failures: string[]; testFiles: number } | undefined> {
  try {
    const report = JSON.parse(await readFile(reportPath, "utf-8")) as {
      testResults?: { name: string; status: string; assertionResults?: { fullName: string; status: string }[] }[];
    };
    if (!Array.isArray(report.testResults)) return undefined;
    const failures: string[] = [];
    // Test runners report resolved paths (on macOS every temp path is under the
    // /var -> /private/var symlink), so IDs compare resolved paths on both sides;
    // otherwise a checkout reached through a symlink gets IDs that never match.
    const root = await resolvedPath(stepDir);
    for (const file of report.testResults) {
      const name = relative(root, await resolvedPath(file.name));
      const failed = (file.assertionResults ?? []).filter((test) => test.status === "failed");
      for (const test of failed) failures.push(`${name} > ${test.fullName}`);
      if (failed.length === 0 && file.status === "failed") failures.push(`${name} > (file)`);
    }
    return { failures, testFiles: report.testResults.length };
  } catch {
    return undefined;
  }
}

function filesOf(ids: string[]): string[] {
  return [...new Set(ids.map((id) => id.split(" > ")[0]!))];
}

/** The test files to rerun for these failures, or the selection (undefined: the whole step) when one names no file. */
function rerunScope(ids: string[], selected: string[] | null): string[] | undefined {
  if (ids.some((id) => id.startsWith(UNHANDLED_PREFIX))) return selected ?? undefined;
  return filesOf(ids);
}

function describeScope(scope: string[] | undefined): string {
  return scope ? `${scope.length} failing test file(s)` : "the whole step";
}

const UNHANDLED_PREFIX = "(unhandled) ";
// Vitest prints each unhandled error under a rule such as "⎯⎯⎯ Uncaught Exception ⎯⎯⎯".
const UNHANDLED_HEADER = /^⎯+ (Uncaught Exception|Unhandled Rejection|Unhandled Error) ⎯+$/;
const UNHANDLED_ORIGIN = /^This error originated in "([^"]+)" test file/;

/**
 * IDs for the unhandled errors in Vitest's output: `file > (unhandled) Name: message` when Vitest
 * names the test file the error came from, `(unhandled) Name: message` otherwise. Numbers in the
 * message are normalized, so the same leak matches across runs and checkouts.
 */
export function unhandledErrorIds(output: string): string[] {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: strips terminal colors
  const lines = output.split("\n").map((line) => line.replace(/\u001b\[[0-9;]*m/g, "").trim());
  const ids: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    if (!UNHANDLED_HEADER.test(lines[index]!)) continue;
    let message = "";
    let file: string | undefined;
    for (let next = index + 1; next < lines.length && !lines[next]!.startsWith("⎯"); next++) {
      const line = lines[next]!;
      if (!message && line) message = line;
      file ??= UNHANDLED_ORIGIN.exec(line)?.[1];
    }
    const label = `${UNHANDLED_PREFIX}${(message || "unknown error").replace(/\d+/g, "#")}`;
    ids.push(file ? `${file} > ${label}` : label);
  }
  return [...new Set(ids)];
}

/** Lines of `candidate` not in `base`, after normalizing numbers and blank lines. */
function newLines(candidate: string[], base: string[]): string[] {
  const known = new Set(base);
  return candidate.filter((line) => !known.has(line));
}

/** The path with symlinks resolved, or unchanged when it does not exist. */
async function resolvedPath(path: string): Promise<string> {
  return realpath(path).catch(() => path);
}

function normalize(output: string, dirs: string[]): string[] {
  return output
    .split("\n")
    .map((line) =>
      dirs
        .reduce((text, dir) => text.split(dir).join("<checkout>"), line)
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
  // Output may name the checkout by either spelling; both normalize the same way.
  const realDir = await resolvedPath(dir);
  const dirs = realDir === dir ? [dir] : [realDir, dir];
  options.log(`$ (${relative(dir, workdir) || "."}) ${argv.join(" ")}`);
  return new Promise((resolvePromise, reject) => {
    const child = spawn(argv[0]!, argv.slice(1), {
      cwd: workdir,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      // Its own process group, so stopping the gate also stops the command's children (test workers).
      detached: true,
    });
    activeCommands.add(child);
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
      activeCommands.delete(child);
      const lines = output.split("\n");
      resolvePromise({
        ok: code === 0,
        tail: lines.slice(-80).join("\n"),
        lines: code === 0 ? [] : normalize(output, dirs),
        ...(code === 0 ? {} : { output }),
      });
    });
  });
}
