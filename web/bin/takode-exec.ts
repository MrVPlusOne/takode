/**
 * `takode exec`: run a command on another machine (a registered host, or the
 * coordinator's own machine by its name) over its `takode node` link, and
 * follow, read and stop such commands. The server records every call and
 * keeps its output.
 */

import { constants } from "node:os";
import { describeExecOutcome, type ExecJob } from "../shared/host-exec.js";
import { formatBytes } from "../shared/memory-guard.js";
import { formatLeaseWaitDuration as formatDuration } from "../shared/resource-lease-message.js";
import { nestedPoolWarning, STILL_WAITING_EVERY_MS, stillWaitingLine } from "./pool-wait-notes.js";
import { apiPost, err, takodeAuthHeaders } from "./takode-core.js";

export const EXEC_USAGE = [
  "Usage: takode exec --host <machine> [--pool <name>] [--cwd <dir>] [--memory-limit <size>] [--json] -- <command...>",
  "       takode exec --pool <name> [--cwd <dir>] [--memory-limit <size>] [--json] -- <command...>",
  "       takode exec status <id> [--json]",
  "       takode exec logs <id> [--lines <from>-<to> | --bytes <from>-<to> | --tail <lines>]",
  "       takode exec kill <id>",
  "       takode exec list [--all] [--json]",
].join("\n");

export const EXEC_HELP = `${EXEC_USAGE}

Run a command on another machine that has a Takode node: a registered host
(takode host list) or the Takode server's own machine, by its name. It runs as
that machine's user, as a login shell of their own shell (bash, zsh...), in
--cwd or their home directory (quote a leading ~ so your own shell does not
expand it), with no input. Output (stdout and stderr together) and the exit
code come back as if it ran here; whatever the login profile itself prints is
left out. Long output shows both ends and names the lines left out, which
takode exec logs shows.

It waits until the command ends, however long that takes, like a local
command, and stopping it (Ctrl-C, a tool timeout) stops the command. Run a
long command the way you run any long command: in your own background shell
or terminal (Claude: Bash with run_in_background; Codex: a background
terminal), or give your shell tool a timeout long enough for it.

  --pool <name> Run it while holding a slot of the lease pool
                <name>@<machine> (on the Takode server's own machine, plain
                <name> too), so the commands of every session and
                sub-agent that use the pool share its capacity, such as a
                machine's budget of concurrent compiles. When the pool is
                full the command waits in line, quietly, and starts when a
                slot frees up; the slot is freed when it ends. Without
                --host it runs on any machine where a leader configured the
                pool (takode lease configure <name>@<machine> --capacity <n>),
                starting on the first with a free slot; so the command must
                work on each of them. Time in line counts against your
                tool's timeout; a long wait prints a line every 5 minutes
                saying who holds the pool. Unconfigured pools have one
                slot. The command sees TAKODE_LEASE_RESOURCE and
                TAKODE_LEASE_SLOT. Nested slots can deadlock: a command
                holding a slot whose own commands wait for the same pool
                waits forever once outer commands hold every slot. It is
                allowed, with a warning; take the slot once.
  --memory-limit <size>
                Kill the command and everything it started once they use
                more memory than this together, such as 64G or 512M. Its
                outcome then says so. Off unless given; set it for work whose
                memory could run away, such as big evaluations or builds.
                The node checks every 2 seconds, so memory that grows faster
                can briefly pass it.
  status <id>   The command's state, exit code and times.
  logs <id>     All of its output; save a long one to a file
                (takode exec logs <id> > out.log). --lines 200-400 or
                --bytes 1-50000 for a part (1-based, inclusive), --tail <n>
                for the last lines.
  kill <id>     Stop it and everything it started (SIGTERM, then SIGKILL).
  list          Your recent commands; --all for every session's.

Every call is recorded with its session, quest, machine, command and outcome.
The user can turn commands off for a machine in Settings. Commands on another
machine are still yours: ask the user first wherever you would ask before
running them here, such as cluster job launches or changes to shared data.`;

/** How long one request waits for the command to end before asking again. */
const WAIT_SECONDS = 25;
/**
 * How long to keep retrying while the coordinator is unreachable, e.g. restarting.
 * The server stops a command nobody asked about for as long (`CALLER_GONE_MS`).
 */
const RECONNECT_MS = 5 * 60_000;

const BACKGROUND_REMOVED =
  "--background was removed: takode exec now runs until the command ends. Run a long command with your own " +
  "background mechanism (Claude: Bash run_in_background; Codex: a background terminal), or give your shell " +
  "tool a timeout long enough for it.";

type OutputResponse = { output: string; bytes: number; truncated: boolean };

export async function handleExec(base: string, args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  switch (subcommand) {
    case "status":
      return showStatus(base, rest);
    case "logs":
      return showLogs(base, rest);
    case "kill":
      return killJob(base, rest);
    case "list":
      return listJobs(base, rest);
    default:
      return runCommand(base, args);
  }
}

/** Split `--host x --cwd y -- cmd...` into options and the command, which is passed on untouched. */
export function parseExecRun(args: string[]): {
  host?: string;
  pool?: string;
  cwd?: string;
  memoryLimitBytes?: number;
  json: boolean;
  command: string;
} {
  const parsed = { json: false, command: "" } as ReturnType<typeof parseExecRun>;
  let index = 0;
  for (; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--") {
      index++;
      break;
    }
    if (arg === "--host" || arg === "--cwd" || arg === "--pool") {
      const value = args[++index];
      if (value === undefined) err(`${arg} needs a value\n${EXEC_USAGE}`);
      parsed[arg.slice(2) as "host" | "cwd" | "pool"] = value;
    } else if (arg === "--memory-limit") {
      const value = args[++index];
      if (value === undefined) err(`--memory-limit needs a size, such as 64G\n${EXEC_USAGE}`);
      parsed.memoryLimitBytes = parseMemorySize(value);
    } else if (arg === "--background") err(BACKGROUND_REMOVED);
    else if (arg === "--json") parsed.json = true;
    else if (arg.startsWith("--")) err(`Unknown option ${arg}\n${EXEC_USAGE}`);
    else break;
  }
  parsed.command = args.slice(index).join(" ");
  return parsed;
}

/**
 * A memory size such as `64G`, `512M`, `1.5T` or `64GiB`, in bytes. The unit
 * is required, so a bare `64` cannot mean 64 bytes by mistake.
 */
export function parseMemorySize(value: string): number {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*([KMGT])(?:i?B)?$/i);
  const bytes = match ? Math.round(Number(match[1]) * 1024 ** ("KMGT".indexOf(match[2]!.toUpperCase()) + 1)) : 0;
  if (bytes <= 0) err(`--memory-limit needs a size with a unit, such as 64G or 512M (got ${value})`);
  return bytes;
}

async function runCommand(base: string, args: string[]): Promise<void> {
  const options = parseExecRun(args);
  if (!options.host && !options.pool) err(`--host or --pool is required\n${EXEC_USAGE}`);
  if (!options.command.trim()) err(`Give the command after --\n${EXEC_USAGE}`);
  const nested = options.pool ? nestedPoolWarning(options.pool) : null;
  if (nested) console.error(`[takode exec] ${nested}`);
  const { job: started } = (await apiPost(base, "/takode/exec", {
    ...(options.host ? { host: options.host } : {}),
    ...(options.pool ? { pool: options.pool } : {}),
    command: options.command,
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.memoryLimitBytes ? { memoryLimitBytes: options.memoryLimitBytes } : {}),
  })) as { job: ExecJob };

  // Interrupted or timed out, the command stops with its caller, like a local one.
  const stop = async (signal: NodeJS.Signals) => {
    await apiPost(base, `/takode/exec/jobs/${started.id}/kill`).catch(() => {});
    console.error(
      `[takode exec] stopped ${started.id} on ${started.host}; its output so far: takode exec logs ${started.id}`,
    );
    process.exit(128 + (constants.signals[signal] ?? 2));
  };
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.once(signal, () => void stop(signal));

  let job = started;
  if (job.status === "queued") console.error(`[${job.id} is waiting for a slot of ${job.pool} on ${job.host}]`);
  const queuedAt = Date.now();
  let notedAt = queuedAt;
  while (job.status === "running" || job.status === "queued") {
    const queued = job.status === "queued";
    const answer = (await getWithRetry(base, `/takode/exec/jobs/${job.id}?wait=${WAIT_SECONDS}`)) as {
      job: ExecJob;
      slotWait?: string;
    };
    job = answer.job;
    if (queued && job.status === "running") {
      console.error(`[${job.id} got slot ${job.slot?.slot} of ${job.slot?.resourceKey}; running on ${job.host}]`);
    }
    if (job.status === "queued" && Date.now() - notedAt >= STILL_WAITING_EVERY_MS) {
      notedAt = Date.now();
      console.error(`[${job.id} ${stillWaitingLine(notedAt - queuedAt, answer.slotWait)}]`);
    }
  }
  const output = (await getWithRetry(base, `/takode/exec/jobs/${job.id}/output`)) as OutputResponse;
  process.exitCode = exitCodeOf(job);
  if (options.json) return printJson({ job, ...output });
  process.stdout.write(output.output);
  if (output.output && !output.output.endsWith("\n")) process.stdout.write("\n");
  console.error(`[${job.id} on ${job.host}: ${describeExecOutcome(job)}, ${formatDuration(durationOf(job))}]`);
}

async function showStatus(base: string, args: string[]): Promise<void> {
  const id = jobId(args);
  const { job, slotWait } = (await getWithRetry(base, `/takode/exec/jobs/${encodeURIComponent(id)}`)) as {
    job: ExecJob;
    slotWait?: string;
  };
  if (args.includes("--json")) return printJson({ job, ...(slotWait ? { slotWait } : {}) });
  console.log(formatJobLine(job));
  if (slotWait) console.log(`  ${slotWait}`);
  console.log(`  $ ${job.command}`);
  if (job.cwd) console.log(`  in ${job.cwd}`);
  if (job.memoryLimitBytes) console.log(`  memory limit ${formatBytes(job.memoryLimitBytes)}`);
  if (job.error) console.log(`  ${job.error}`);
}

async function showLogs(base: string, args: string[]): Promise<void> {
  const id = encodeURIComponent(jobId(args));
  const tail = valueOf(args, "--tail");
  if (tail !== undefined) {
    const output = (await getWithRetry(
      base,
      `/takode/exec/jobs/${id}/output?tail=${encodeURIComponent(tail)}`,
    )) as OutputResponse;
    process.stdout.write(output.output);
    return;
  }
  // `--full` named everything before logs did so by default; it still works.
  const lines = valueOf(args, "--lines");
  const bytes = valueOf(args, "--bytes");
  const query =
    lines !== undefined
      ? `?lines=${encodeURIComponent(lines)}`
      : bytes !== undefined
        ? `?bytes=${encodeURIComponent(bytes)}`
        : "";
  const response = await fetchWithRetry(base, `/takode/exec/jobs/${id}/log${query}`);
  // Streamed, so output of any size reaches stdout (or a file) whole.
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    if (!process.stdout.write(chunk)) await new Promise((resolve) => process.stdout.once("drain", resolve));
  }
}

function valueOf(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : (args[index + 1] ?? "");
}

async function killJob(base: string, args: string[]): Promise<void> {
  const id = jobId(args);
  const { job } = (await apiPost(base, `/takode/exec/jobs/${encodeURIComponent(id)}/kill`)) as { job: ExecJob };
  console.log(
    job.status === "running"
      ? `Stopping ${job.id} on ${job.host}; it gets SIGKILL if it is still running in 10s.`
      : `${job.id} already ended (${describeExecOutcome(job)}).`,
  );
}

async function listJobs(base: string, args: string[]): Promise<void> {
  const { jobs } = (await getWithRetry(base, `/takode/exec/jobs${args.includes("--all") ? "?all=1" : ""}`)) as {
    jobs: ExecJob[];
  };
  if (args.includes("--json")) return printJson({ jobs });
  if (jobs.length === 0) {
    console.log("No commands yet.");
    return;
  }
  for (const job of jobs) {
    const command = job.command.length > 100 ? `${job.command.slice(0, 100)}...` : job.command;
    console.log(`${formatJobLine(job)}  $ ${command}`);
  }
}

function formatJobLine(job: ExecJob): string {
  const owner = job.sessionNum !== null ? `#${job.sessionNum}` : "a session";
  const quest = job.questId ? ` ${job.questId}` : "";
  const when = new Date(job.startedAt).toISOString().slice(0, 16).replace("T", " ");
  const took = formatDuration(durationOf(job));
  const state =
    job.status === "running"
      ? `running for ${took}`
      : job.status === "queued"
        ? `waiting for a slot of ${job.pool} for ${took}`
        : `${describeExecOutcome(job)} after ${took}`;
  return `${job.id}  ${job.host}  ${state}  (${owner}${quest}, started ${when} UTC)`;
}

function durationOf(job: ExecJob): number {
  return (job.endedAt ?? Date.now()) - job.startedAt;
}

/** The remote exit code, 128 + signal number for a signal, 255 when the command could not run (as ssh does). */
function exitCodeOf(job: ExecJob): number {
  if (job.signal) return 128 + (constants.signals[job.signal as keyof typeof constants.signals] ?? 0);
  return job.exitCode ?? 255;
}

function jobId(args: string[]): string {
  const id = args.find(
    (arg, index) => !arg.startsWith("--") && !["--tail", "--lines", "--bytes"].includes(args[index - 1] ?? ""),
  );
  if (!id) err(`Name the command, e.g. x-12\n${EXEC_USAGE}`);
  return id;
}

/** A GET's JSON answer, waiting out a coordinator that is briefly unreachable (see {@link fetchWithRetry}). */
async function getWithRetry(base: string, path: string): Promise<unknown> {
  return (await fetchWithRetry(base, path)).json();
}

/** A successful GET response, waiting out a coordinator that is briefly unreachable, such as during a restart. */
async function fetchWithRetry(base: string, path: string): Promise<Response> {
  const deadline = Date.now() + RECONNECT_MS;
  for (;;) {
    let response: Response;
    try {
      response = await fetch(`${base}${path}`, { headers: takodeAuthHeaders() });
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await Bun.sleep(1_000);
      continue;
    }
    if ((response.status === 502 || response.status === 503) && Date.now() < deadline) {
      await Bun.sleep(1_000);
      continue;
    }
    if (response.ok) return response;
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `HTTP ${response.status}`);
  }
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}
