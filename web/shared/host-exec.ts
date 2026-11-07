/**
 * Shared contract for `takode exec`: commands a session runs on a registered
 * host (or the coordinator's own machine) over that machine's `takode node`
 * link. The server keeps one record per call; the CLI and the feed's
 * finished-command chip read these shapes.
 */

import { formatBytes } from "./memory-guard.js";

/**
 * Source of the message that told a session a command started with the
 * retired `--background` flag finished. Sessions keep these in their history,
 * and a coordinator that took such a command over still sends one.
 */
export const HOST_EXEC_MESSAGE_SOURCE = { sessionId: "host-exec", sessionLabel: "Remote Command" } as const;

/** First words of that message, which the feed's chip recognizes. */
export const HOST_EXEC_MESSAGE_TAG = "[Command finished]";

/** `running` until the process ends; `failed` when it could not start or its host lost it. */
export type ExecJobStatus = "running" | "exited" | "failed";

export interface ExecJob {
  /** Short id agents pass to `takode exec status|logs|kill`, e.g. `x-12`. */
  id: string;
  /** Registered host id, or `local` for the coordinator's own machine. */
  hostId: string;
  /** The machine's name when the command started. */
  host: string;
  command: string;
  /** Working directory on the machine; null for its home directory. */
  cwd: string | null;
  /** Session that ran it, which owns it. */
  sessionId: string;
  sessionNum: number | null;
  /** Quest the session had claimed when it ran the command. */
  questId: string | null;
  status: ExecJobStatus;
  startedAt: number;
  endedAt: number | null;
  exitCode: number | null;
  /** Signal that ended the process, e.g. after `takode exec kill`. */
  signal: string | null;
  /** Why the process could not start or was lost. */
  error: string | null;
  /** Output bytes produced so far (stdout and stderr together). */
  outputBytes: number;
  /** The memory its processes may use together (`--memory-limit`); absent or null for none. */
  memoryLimitBytes?: number | null;
  /** Why the node's memory guard killed it, when it did. */
  memoryKill?: ExecMemoryKill | null;
  /** Stopped because its caller went away without stopping it. */
  callerGone?: boolean;
}

/** A command the memory guard of its machine's node killed. */
export interface ExecMemoryKill {
  /** `command_limit`: over its own `memoryLimitBytes`; `machine`: the machine was nearly out of memory. */
  reason: "machine" | "command_limit";
  /** Memory its killed processes held. */
  bytes: number;
  /** Their program names, largest first, such as `lean ×93`. */
  programs: string[];
}

/** One-line outcome such as "exit 0", "killed by SIGTERM" or "failed: <reason>". */
export function describeExecOutcome(
  job: Pick<ExecJob, "status" | "exitCode" | "signal" | "error" | "memoryLimitBytes" | "memoryKill" | "callerGone">,
): string {
  if (job.status === "running") return "running";
  const kill = job.memoryKill;
  if (kill?.reason === "command_limit" && job.memoryLimitBytes) {
    return `killed for using ${formatBytes(kill.bytes)}, over its ${formatBytes(job.memoryLimitBytes)} memory limit (${kill.programs.join(", ")})`;
  }
  if (kill) return `killed by the memory guard: the machine was nearly out of memory`;
  if (job.callerGone) return "stopped: its caller went away";
  if (job.signal) return `killed by ${job.signal}`;
  if (job.status === "failed" || job.exitCode === null) return `failed: ${job.error ?? "the process was lost"}`;
  return `exit ${job.exitCode}`;
}
