/**
 * `takode exec`: run a command on another machine (a registered host, or the
 * coordinator's own machine by its name) over its `takode node` link, and
 * follow, read and stop such commands. The server records every call and
 * keeps its output.
 */

import { constants } from "node:os";
import { describeExecOutcome, type ExecJob } from "../shared/host-exec.js";
import { formatLeaseWaitDuration as formatDuration } from "../shared/resource-lease-message.js";
import { apiPost, err, takodeAuthHeaders } from "./takode-core.js";

export const EXEC_USAGE = [
  "Usage: takode exec --host <machine> [--cwd <dir>] [--background] [--json] -- <command...>",
  "       takode exec status <id> [--json]",
  "       takode exec logs <id> [--full | --tail <lines>]",
  "       takode exec kill <id>",
  "       takode exec list [--all] [--json]",
].join("\n");

export const EXEC_HELP = `${EXEC_USAGE}

Run a command on another machine that has a Takode node: a registered host
(takode host list) or the Takode server's own machine, by its name. It runs as
that machine's user, in their login shell, in --cwd or their home directory
(quote a leading ~ so your own shell does not expand it), with no input.
Output (stdout and stderr together) and the exit code come back as if it ran
here; long output shows both ends, with the rest in takode exec logs <id>.

  --background  Return a job id at once. The command keeps running if this
                session stops or disconnects, and you get a message when it
                finishes. A foreground run that is interrupted or times out
                becomes a background run the same way.
  status <id>   The command's state, exit code and times.
  logs <id>     Its output: both ends when long, --full for all of it,
                --tail <lines> for the last lines.
  kill <id>     Stop it and everything it started (SIGTERM, then SIGKILL).
  list          Your recent commands; --all for every session's.

Every call is recorded with its session, quest, machine, command and outcome.
The user can turn commands off for a machine in Settings. Commands on another
machine are still yours: ask the user first wherever you would ask before
running them here, such as cluster job launches or changes to shared data.`;

/** How long one request waits for the command to end before asking again. */
const WAIT_SECONDS = 25;
/** How long to keep retrying while the coordinator is unreachable, e.g. restarting. */
const RECONNECT_MS = 120_000;

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
  cwd?: string;
  background: boolean;
  json: boolean;
  command: string;
} {
  const parsed = { background: false, json: false, command: "" } as ReturnType<typeof parseExecRun>;
  let index = 0;
  for (; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--") {
      index++;
      break;
    }
    if (arg === "--host" || arg === "--cwd") {
      const value = args[++index];
      if (value === undefined) err(`${arg} needs a value\n${EXEC_USAGE}`);
      parsed[arg === "--host" ? "host" : "cwd"] = value;
    } else if (arg === "--background") parsed.background = true;
    else if (arg === "--json") parsed.json = true;
    else if (arg.startsWith("--")) err(`Unknown option ${arg}\n${EXEC_USAGE}`);
    else break;
  }
  parsed.command = args.slice(index).join(" ");
  return parsed;
}

async function runCommand(base: string, args: string[]): Promise<void> {
  const options = parseExecRun(args);
  if (!options.host) err(`--host is required\n${EXEC_USAGE}`);
  if (!options.command.trim()) err(`Give the command after --\n${EXEC_USAGE}`);
  const { job: started } = (await apiPost(base, "/takode/exec", {
    host: options.host,
    command: options.command,
    ...(options.cwd ? { cwd: options.cwd } : {}),
    background: options.background,
  })) as { job: ExecJob };

  if (options.background) {
    if (options.json) return printJson({ job: started });
    console.log(
      `Started ${started.id} on ${started.host}. You will get a message when it finishes; ` +
        `follow it with takode exec status|logs|kill ${started.id}.`,
    );
    return;
  }

  // Stopped or timed out, the command keeps running and the session hears when it ends.
  const detach = async () => {
    await apiPost(base, `/takode/exec/jobs/${started.id}/detach`).catch(() => {});
    console.error(
      `[takode exec] ${started.id} keeps running on ${started.host}; you will get a message when it finishes. ` +
        `Follow it with takode exec status|logs|kill ${started.id}.`,
    );
    process.exit(130);
  };
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.once(signal, () => void detach());

  let job = started;
  while (job.status === "running") {
    job = ((await getWithRetry(base, `/takode/exec/jobs/${job.id}?wait=${WAIT_SECONDS}`)) as { job: ExecJob }).job;
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
  const { job } = (await getWithRetry(base, `/takode/exec/jobs/${encodeURIComponent(id)}`)) as { job: ExecJob };
  if (args.includes("--json")) return printJson({ job });
  console.log(formatJobLine(job));
  console.log(`  $ ${job.command}`);
  if (job.cwd) console.log(`  in ${job.cwd}`);
  if (job.error) console.log(`  ${job.error}`);
}

async function showLogs(base: string, args: string[]): Promise<void> {
  const id = jobId(args);
  const tailIndex = args.indexOf("--tail");
  const query = args.includes("--full")
    ? "?full=1"
    : tailIndex !== -1
      ? `?tail=${encodeURIComponent(args[tailIndex + 1] ?? "")}`
      : "";
  const output = (await getWithRetry(
    base,
    `/takode/exec/jobs/${encodeURIComponent(id)}/output${query}`,
  )) as OutputResponse;
  process.stdout.write(output.output);
  if (output.output && !output.output.endsWith("\n")) process.stdout.write("\n");
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
  const state = job.status === "running" ? `running for ${took}` : `${describeExecOutcome(job)} after ${took}`;
  return `${job.id}  ${job.host}  ${state}  (${owner}${quest}, started ${when} UTC${job.background ? ", background" : ""})`;
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
  const id = args.find((arg, index) => !arg.startsWith("--") && args[index - 1] !== "--tail");
  if (!id) err(`Name the command, e.g. x-12\n${EXEC_USAGE}`);
  return id;
}

/** A GET that waits out a coordinator that is briefly unreachable, such as during a restart. */
async function getWithRetry(base: string, path: string): Promise<unknown> {
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
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
  }
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}
