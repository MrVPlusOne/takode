/**
 * Shared contract for `takode exec`: commands a session runs on a registered
 * host (or the coordinator's own machine) over that machine's `takode node`
 * link. The server keeps one record per call; the CLI and the feed's
 * finished-command chip read these shapes.
 */

/** Source of the message that tells a session its background command finished. */
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
  /** Session that ran it, which owns it and is told when a background run finishes. */
  sessionId: string;
  sessionNum: number | null;
  /** Quest the session had claimed when it ran the command. */
  questId: string | null;
  /** Started with `--background`, or its foreground caller stopped waiting or never collected the result. */
  background: boolean;
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
}

/** One-line outcome such as "exit 0", "killed by SIGTERM" or "failed: <reason>". */
export function describeExecOutcome(job: Pick<ExecJob, "status" | "exitCode" | "signal" | "error">): string {
  if (job.status === "running") return "running";
  if (job.signal) return `killed by ${job.signal}`;
  if (job.status === "failed" || job.exitCode === null) return `failed: ${job.error ?? "the process was lost"}`;
  return `exit ${job.exitCode}`;
}
