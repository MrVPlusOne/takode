// ─── Session Timer Types ─────────────────────────────────────────────────────

/** A single session-scoped timer. */
export interface SessionTimer {
  /** Short readable ID: "t1", "t2", etc. */
  id: string;
  /** Session that owns this timer. */
  sessionId: string;
  /** Recorded leader destination ("main" or "q-N"); absent on unassociated timers. */
  threadKey?: string;
  /** Concise one-line summary for humans scanning timer lists. */
  title: string;
  /** Additional detail for the model when the timer fires. */
  description: string;
  /** Timer schedule type. */
  type: "delay" | "at" | "recurring";
  /** Original spec as entered by the user (e.g. "30m", "3pm", "every 10m"). */
  originalSpec: string;
  /** Absolute epoch ms when a one-shot timer should fire. For recurring, the NEXT fire time. */
  nextFireAt: number;
  /** For recurring timers: interval in ms. */
  intervalMs?: number;
  /** When the timer was created (epoch ms). */
  createdAt: number;
  /** Last time this timer fired (epoch ms), if ever. */
  lastFiredAt?: number;
  /** Total number of times this timer has fired. */
  fireCount: number;
  /** A recurring timer's check: at each tick the server runs it instead of waking the session. */
  check?: TimerCheck;
}

/**
 * A command the server runs at each tick of a recurring timer. The session is
 * woken only when it passes (exits 0), which ends the timer, and on every
 * `wakeEvery`-th check that did not pass, with the latest result, so a check
 * written wrong cannot keep the session asleep.
 */
export interface TimerCheck {
  command: string;
  /** Name of the machine it runs on. */
  host: string;
  /** Folder it runs in; the machine user's home when absent. */
  cwd?: string;
  /** Wake with the latest result after this many checks in a row that did not pass. */
  wakeEvery: number;
  /** Checks since the timer was created or last woke the session. */
  checksSinceWake: number;
  lastResult?: TimerCheckResult;
}

/** One run of a timer's check. */
export interface TimerCheckResult {
  /** When it ended (epoch ms). */
  at: number;
  /** Its exit code; null when it could not run or was stopped. */
  exitCode: number | null;
  /** Its stdout and stderr together, shortened in the middle when long. */
  output: string;
  /** Why it could not run or finish (machine unreachable, time limit), if so. */
  error?: string;
}

/** Persisted JSON file format for a session's timers. */
export interface SessionTimerFile {
  sessionId: string;
  /** Counter for generating "t{N}" IDs. */
  nextId: number;
  timers: SessionTimer[];
}

/** Input for creating a timer via REST API or CLI. Exactly one of in/at/every must be provided. */
export interface TimerCreateInput {
  title: string;
  description?: string;
  /** Explicit leader destination; otherwise creation may use the current active thread. */
  threadKey?: string;
  /** Relative delay: "30m", "2h", "45s" */
  in?: string;
  /** Wall-clock time: "3pm", "15:00", "3:30pm" */
  at?: string;
  /** Recurring interval: "10m", "1h", "30s" */
  every?: string;
  /** A check to run at each tick instead of waking the session (needs `every`). */
  check?: string;
  /** Machine the check runs on; the session's own machine by default. */
  host?: string;
  /** Wake after this many checks that did not pass (default 10). */
  wakeEvery?: number;
}

/** Server-owned provenance for one timer occurrence, retained through delivery holds. */
export interface TimerFiring {
  timerId: string;
  scheduledFireAt: number;
}
