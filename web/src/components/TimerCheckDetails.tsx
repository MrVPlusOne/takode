import type { TimerCheck } from "../../server/timer-types.js";
import { timeAgo } from "../utils/quest-helpers.js";

/** Lines of a check's output shown under it; the full output stays in the wake message. */
const SHOWN_OUTPUT_LINES = 6;

/**
 * A timer's check: the command and the machine it runs on, its latest result
 * and output, and how many more checks may go by before the session is woken
 * anyway. Lets a user see a job's progress without waking the session.
 */
export function TimerCheckDetails({ check }: { check: TimerCheck }) {
  const last = check.lastResult;
  const outcome = !last
    ? "not run yet"
    : last.error
      ? `could not run (${last.error})`
      : last.exitCode === 0
        ? "passed"
        : `not yet (exit ${last.exitCode})`;
  const output = last?.output.trim().split(/\r?\n/).slice(-SHOWN_OUTPUT_LINES).join("\n");
  const remaining = Math.max(0, check.wakeEvery - check.checksSinceWake);
  return (
    <div className="space-y-1 pt-0.5 text-[11px] text-cc-muted" data-testid="timer-check">
      <p className="break-words">
        Checks on {check.host}: <code className="font-mono-code text-cc-fg/80">{check.command}</code>
      </p>
      <p>
        Last check{last ? ` ${timeAgo(last.at)}` : ""}: {outcome} · wakes the session when it passes, or after{" "}
        {remaining === 1 ? "1 more check" : `${remaining} more checks`}
      </p>
      {output && (
        <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-words rounded-md bg-cc-bg/60 px-2 py-1 font-mono-code text-cc-fg/70">
          {output}
        </pre>
      )}
    </div>
  );
}
