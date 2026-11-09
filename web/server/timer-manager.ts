import { serverWorkAdmission } from "./server-work-admission.js";
import type { WsBridge } from "./ws-bridge.js";
import type { SessionTimer, SessionTimerFile, TimerCheckResult, TimerCreateInput } from "./timer-types.js";
import type { BrowserIncomingMessage } from "./session-types.js";
import { resolveTimerSchedule } from "./timer-parse.js";
import * as timerStore from "./timer-store.js";
import { normalizeThreadTarget } from "../shared/thread-routing.js";
import { normalizeThreadRoute } from "./thread-routing-metadata.js";
import { middleTruncate } from "../shared/host-exec.js";

const SWEEP_INTERVAL_MS = 5_000;
const MAX_TIMERS_PER_SESSION = 50;
const LATE_TIMER_THRESHOLD_MS = 5 * 60_000;
const LOG_TAG = "[timer-manager]";
/** Default checks in a row that may not pass before the session is woken with the latest result. */
export const DEFAULT_CHECK_WAKE_EVERY = 10;
const MIN_CHECK_INTERVAL_MS = 60_000;
/** A check running longer is stopped and counts as not passed. */
const CHECK_TIMEOUT_MS = 2 * 60_000;
/** Output shown in a wake message: this many characters, half from each end. */
const CHECK_MESSAGE_OUTPUT_CHARS = 2_000;

/** Runs timer checks on machines (in production `HostExec.check` through each machine's node). */
export interface TimerCheckRunner {
  /** Where a session's check runs: the named machine, or the session's own machine and folder. */
  target(sessionId: string, host: string | undefined): Promise<{ host: string; cwd?: string }>;
  run(input: { host: string; command: string; cwd?: string; timeoutMs: number }): Promise<Omit<TimerCheckResult, "at">>;
}

interface TimerFireContext {
  scheduledFireAt: number;
  skippedCount?: number;
}

export interface TimerSweepResult {
  fired: Array<{
    sessionId: string;
    timerId: string;
    delivery: "sent" | "queued" | "paused_queued" | "dropped" | "no_session";
  }>;
  skipped: Array<{
    sessionId: string;
    timerId: string;
    reason: "session_paused";
  }>;
}

export class TimerManager {
  /** In-memory cache: sessionId -> SessionTimerFile */
  private sessions = new Map<string, SessionTimerFile>();
  private pendingWrites = new Set<Promise<void>>();
  private writeFailures = new Map<string, unknown>();
  private writeChains = new Map<string, Promise<void>>();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  /** `sessionId:timerId` of checks running now, so a slow check is never started twice. */
  private runningChecks = new Set<string>();

  constructor(
    private wsBridge: WsBridge,
    private checks: TimerCheckRunner | null = null,
  ) {}

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /** Load all timer files from disk and start the sweep loop. Called at server startup. */
  async startAll(): Promise<void> {
    const sessionIds = await timerStore.listTimerSessions();
    let loaded = 0;
    for (const sid of sessionIds) {
      const data = await timerStore.loadTimers(sid);
      if (data.timers.length > 0) {
        this.sessions.set(sid, data);
        loaded++;
      }
    }
    if (loaded > 0) {
      console.log(`${LOG_TAG} Loaded timers for ${loaded} session(s)`);
    }

    this.startSweep();
  }

  /** Stop the sweep loop and clear in-memory state. Called on shutdown. */
  destroy(): void {
    this.stopDispatch();
    this.sessions.clear();
  }

  /** Stop firing while retaining timers and accepted writes for the persistence barrier. */
  stopDispatch(): void {
    this.stopSweep();
  }

  /** Wait for accepted timer changes and retain failures instead of exiting with lost firings. */
  async flush(): Promise<void> {
    while (this.pendingWrites.size) await Promise.allSettled([...this.pendingWrites]);
    if (this.writeFailures.size) throw new AggregateError([...this.writeFailures.values()], "Unsaved timer state");
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────

  /**
   * Create a new timer for a session. Returns the created timer.
   *
   * A timer with a check runs it once right away: a check that cannot run, or
   * whose command is missing (exit 126/127), is refused with its output, and
   * one that already passes is returned with that result but not kept, since
   * there is nothing to wait for.
   */
  async createTimer(sessionId: string, input: TimerCreateInput): Promise<SessionTimer> {
    const title = input.title?.trim();
    if (!title) throw new Error("Timer title is required");
    const threadTarget = typeof input.threadKey === "string" ? normalizeThreadTarget(input.threadKey) : null;
    if (input.threadKey !== undefined && !threadTarget) {
      throw new Error("Timer thread must be main, q-N or t-N");
    }

    const schedule = resolveTimerSchedule(input);
    if (!Number.isFinite(schedule.nextFireAt)) throw new Error("Invalid timer schedule: non-finite fire time");

    const file = await this.getOrCreateFile(sessionId);
    if (file.timers.length >= MAX_TIMERS_PER_SESSION) {
      throw new Error(`Timer limit reached (max ${MAX_TIMERS_PER_SESSION} per session)`);
    }

    const check = input.check !== undefined ? await this.firstCheck(sessionId, input, schedule) : undefined;
    // A check that already passes leaves nothing to wait for: report it without keeping a timer.
    const kept = check?.lastResult?.exitCode !== 0;
    const id = `t${kept ? file.nextId++ : file.nextId}`;

    const timer: SessionTimer = {
      id,
      sessionId,
      ...(threadTarget ? { threadKey: threadTarget.threadKey } : {}),
      title,
      description: input.description?.trim() ?? "",
      type: schedule.type,
      originalSpec: schedule.originalSpec,
      nextFireAt: schedule.nextFireAt,
      intervalMs: schedule.intervalMs,
      createdAt: Date.now(),
      fireCount: 0,
      ...(check ? { check } : {}),
    };
    if (!kept) return timer;

    file.timers.push(timer);
    await this.persistSessionNow(sessionId);
    this.broadcastTimers(sessionId);

    console.log(
      `${LOG_TAG} Created timer ${id} for session ${sessionId.slice(0, 8)} ` +
        `(${timer.type}, fires ${new Date(timer.nextFireAt).toISOString()})`,
    );

    return timer;
  }

  /** Cancel (delete) a timer. Returns true if found and removed.
   *  Injects a message into the session so the agent knows the user cancelled it. */
  async cancelTimer(sessionId: string, timerId: string): Promise<boolean> {
    const file = this.sessions.get(sessionId);
    if (!file) return false;

    const idx = file.timers.findIndex((t) => t.id === timerId);
    if (idx === -1) return false;

    const timer = file.timers[idx];
    file.timers.splice(idx, 1);
    await this.persistAndEvictIfEmptyNow(sessionId);
    this.broadcastTimers(sessionId);

    // Notify the agent that the user manually cancelled this timer
    const content = `[⏰ Timer ${timerId} cancelled] ${timer.title}`;
    this.wsBridge.injectUserMessage(
      sessionId,
      content,
      { sessionId: `timer:${timerId}`, sessionLabel: `Timer ${timerId}` },
      undefined,
      normalizeThreadRoute(timer.threadKey) ?? undefined,
    );

    console.log(`${LOG_TAG} Cancelled timer ${timerId} for session ${sessionId.slice(0, 8)}`);
    return true;
  }

  /** List all active timers for a session. */
  listTimers(sessionId: string): SessionTimer[] {
    return this.sessions.get(sessionId)?.timers ?? [];
  }

  /** Return sessions with at least one due timer. Future timers remain scheduled. */
  getDueTimerSessionIds(now = Date.now()): string[] {
    const sessionIds: string[] = [];
    for (const [sessionId, file] of this.sessions) {
      if (file.timers.some((timer) => timer.nextFireAt <= now)) {
        sessionIds.push(sessionId);
      }
    }
    return sessionIds;
  }

  /** Run one immediate due-timer sweep. Used at startup so due timers do not wait for browser navigation. */
  async sweepDueTimersNow(now = Date.now()): Promise<TimerSweepResult> {
    return serverWorkAdmission.track(this.sweep(now), "timer sweep");
  }

  /** Cancel all timers for a session (on archive). Deletes persistence file. */
  async cancelAllTimers(sessionId: string): Promise<void> {
    const had = this.sessions.has(sessionId);
    this.sessions.delete(sessionId);

    await timerStore.deleteTimers(sessionId);

    if (had) {
      this.broadcastTimers(sessionId);
      console.log(`${LOG_TAG} Cancelled all timers for session ${sessionId.slice(0, 8)}`);
    }
  }

  /** Validate a new timer's check and run it once (see {@link createTimer}). */
  private async firstCheck(
    sessionId: string,
    input: TimerCreateInput,
    schedule: { type: SessionTimer["type"]; intervalMs?: number },
  ): Promise<NonNullable<SessionTimer["check"]>> {
    const command = input.check?.trim();
    if (!command) throw new Error("The check command is empty");
    if (schedule.type !== "recurring" || !schedule.intervalMs) throw new Error("A timer with a check needs --every");
    if (schedule.intervalMs < MIN_CHECK_INTERVAL_MS) throw new Error("A timer with a check runs at most every minute");
    const wakeEvery = input.wakeEvery ?? DEFAULT_CHECK_WAKE_EVERY;
    if (!Number.isInteger(wakeEvery) || wakeEvery < 1)
      throw new Error("--wake-every must be a whole number of at least 1");
    if (!this.checks) throw new Error("Timer checks are not available on this server");
    const target = await this.checks.target(sessionId, input.host?.trim() || undefined);
    const result = await this.runCheck({ ...target, command });
    if (result.error || result.exitCode === 126 || result.exitCode === 127) {
      const why = result.error ?? `exit ${result.exitCode}`;
      throw new Error(
        `The check could not run on ${target.host} (${why})${result.output ? `:\n${result.output}` : ""}`,
      );
    }
    return { command, ...target, wakeEvery, checksSinceWake: 0, lastResult: result };
  }

  private async runCheck(input: { host: string; command: string; cwd?: string }): Promise<TimerCheckResult> {
    const result = await this.checks!.run({ ...input, timeoutMs: CHECK_TIMEOUT_MS });
    return { at: Date.now(), ...result };
  }

  /** Run a due timer's check, then wake the session if it passed or after `wakeEvery` checks that did not. */
  private async runDueCheck(sessionId: string, timerId: string): Promise<void> {
    const key = `${sessionId}:${timerId}`;
    const before = this.sessions.get(sessionId)?.timers.find((t) => t.id === timerId);
    if (!before?.check || this.runningChecks.has(key)) return;
    this.runningChecks.add(key);
    let result: TimerCheckResult;
    try {
      const { host, command, cwd } = before.check;
      result = await this.runCheck({ host, command, cwd });
    } finally {
      this.runningChecks.delete(key);
    }
    // The timer may have been cancelled, or the server stopped, while it ran.
    const file = this.sessions.get(sessionId);
    const timer = file?.timers.find((t) => t.id === timerId);
    const check = timer?.check;
    if (!file || !timer || !check || serverWorkAdmission.isStopping()) return;
    check.lastResult = result;
    check.checksSinceWake++;
    const passed = result.exitCode === 0;
    if (passed || check.checksSinceWake >= check.wakeEvery) {
      this.injectTimerMessage(sessionId, timer, this.checkWakeContent(timer, passed), {
        scheduledFireAt: result.at,
      });
      timer.lastFiredAt = result.at;
      timer.fireCount++;
      if (passed) file.timers = file.timers.filter((t) => t.id !== timerId);
      else check.checksSinceWake = 0;
    }
    try {
      await this.persistAndEvictIfEmptyNow(sessionId);
    } catch (err) {
      console.error(`${LOG_TAG} Failed to persist timers for ${sessionId.slice(0, 8)}:`, err);
    }
    this.broadcastTimers(sessionId);
  }

  private checkWakeContent(timer: SessionTimer, passed: boolean): string {
    const check = timer.check!;
    const result = check.lastResult!;
    const count = check.checksSinceWake;
    const checks = count === 1 ? "1 check" : `${count} checks`;
    // The usual reminder header keeps every reminder path (delivery, routing, the feed's timer chip) working.
    const head =
      `[⏰ Timer ${timer.id} reminder] ${timer.title}\n\n` +
      (passed
        ? `Your timer's check passed (exit 0) after ${checks}, so the timer has ended.`
        : `Your timer's check has not passed in ${checks}; it keeps checking every ${timer.originalSpec}. ` +
          `This wake shows its latest result so you can confirm the check tests what you want: ` +
          `if it does not, cancel the timer and create a corrected one; otherwise there is nothing to do.`);
    const outcome = result.error ? `could not run: ${result.error}` : `exit ${result.exitCode}`;
    const output = result.output.trim()
      ? `\n\nOutput:${fenced(middleTruncate(result.output.trim(), CHECK_MESSAGE_OUTPUT_CHARS))}`
      : "\n\nNo output.";
    return (
      head +
      ` This is from your earlier timer note, not a new user instruction.` +
      `\n\nCheck on ${check.host}:${fenced(check.command)}Latest result: ${outcome}` +
      output +
      (timer.description ? `\n\nEarlier note:\n${timer.description}` : "")
    );
  }

  // ── Sweep ──────────────────────────────────────────────────────────────────

  private startSweep(): void {
    this.stopSweep();
    this.sweepTimer = setInterval(() => {
      void this.sweepDueTimersNow();
    }, SWEEP_INTERVAL_MS);
  }

  private stopSweep(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  /** Check all timers, fire any that are due. */
  private async sweep(now = Date.now()): Promise<TimerSweepResult> {
    const result: TimerSweepResult = { fired: [], skipped: [] };
    if (serverWorkAdmission.isStopping()) return result;

    for (const [sessionId, file] of this.sessions) {
      if (serverWorkAdmission.isStopping()) break;
      const toRemove = new Set<string>();
      let changed = false;

      for (const timer of file.timers) {
        if (timer.nextFireAt > now) continue;

        if (this.isSessionPaused(sessionId)) {
          result.skipped.push({ sessionId, timerId: timer.id, reason: "session_paused" });
          continue;
        }

        const fireContext =
          timer.type === "recurring" && timer.intervalMs && timer.intervalMs > 0
            ? this.resolveRecurringFireContext(timer, now)
            : { scheduledFireAt: timer.nextFireAt };
        if (timer.check && timer.intervalMs) {
          // The check, not the session, runs at each tick; it decides whether to wake the session.
          void this.runDueCheck(sessionId, timer.id);
          timer.nextFireAt = fireContext.scheduledFireAt + timer.intervalMs;
          changed = true;
          continue;
        }
        // Timer is due -- fire it.
        const delivery = this.fireTimer(sessionId, timer, fireContext);
        result.fired.push({ sessionId, timerId: timer.id, delivery });
        timer.lastFiredAt = now;
        timer.fireCount++;
        changed = true;

        if (timer.type === "recurring" && timer.intervalMs && timer.intervalMs > 0) {
          timer.nextFireAt = fireContext.scheduledFireAt + timer.intervalMs;
        } else {
          // One-shot (delay or at), or recurring with corrupt intervalMs: remove after firing
          toRemove.add(timer.id);
        }
      }

      if (toRemove.size > 0) {
        file.timers = file.timers.filter((t) => !toRemove.has(t.id));
      }

      if (changed) {
        try {
          await this.persistAndEvictIfEmptyNow(sessionId);
        } catch (err) {
          console.error(`${LOG_TAG} Failed to persist timers for ${sessionId.slice(0, 8)}:`, err);
        }
        this.broadcastTimers(sessionId);
      }
    }

    return result;
  }

  /** Fire a single timer: inject user message into the session. */
  private fireTimer(
    sessionId: string,
    timer: SessionTimer,
    context: TimerFireContext,
  ): "sent" | "queued" | "paused_queued" | "dropped" | "no_session" {
    const content =
      `[⏰ Timer ${timer.id} reminder] ${timer.title}` +
      `\n\nThis is a reminder from your earlier timer note, not a new user instruction.` +
      this.formatSkippedOccurrences(context.skippedCount) +
      this.formatLateDeliveryNote(context.scheduledFireAt, Date.now()) +
      (timer.description ? `\n\nEarlier note:\n${timer.description}` : "");
    return this.injectTimerMessage(sessionId, timer, content, context);
  }

  private injectTimerMessage(
    sessionId: string,
    timer: SessionTimer,
    content: string,
    context: TimerFireContext,
  ): "sent" | "queued" | "paused_queued" | "dropped" | "no_session" {
    const result = this.wsBridge.injectUserMessage(
      sessionId,
      content,
      { sessionId: `timer:${timer.id}`, sessionLabel: `Timer ${timer.id}` },
      undefined,
      normalizeThreadRoute(timer.threadKey) ?? undefined,
      { timerFiring: { timerId: timer.id, scheduledFireAt: context.scheduledFireAt } },
    );
    console.log(`${LOG_TAG} Fired timer ${timer.id} for session ${sessionId.slice(0, 8)}: ${result}`);
    return result;
  }

  private resolveRecurringFireContext(timer: SessionTimer, now: number): TimerFireContext {
    const intervalMs = timer.intervalMs;
    if (!intervalMs || intervalMs <= 0) return { scheduledFireAt: timer.nextFireAt };
    const skippedCount = Math.floor((now - timer.nextFireAt) / intervalMs);
    return {
      scheduledFireAt: timer.nextFireAt + skippedCount * intervalMs,
      skippedCount,
    };
  }

  private isSessionPaused(sessionId: string): boolean {
    const bridge = this.wsBridge as WsBridge & { isSessionPaused?: (sessionId: string) => boolean };
    return bridge.isSessionPaused?.(sessionId) ?? false;
  }

  private formatSkippedOccurrences(skippedCount: number | undefined): string {
    if (!skippedCount || skippedCount <= 0) return "";
    const noun = skippedCount === 1 ? "occurrence was" : "occurrences were";
    return `\n\n${skippedCount} earlier due ${noun} skipped while the session was unavailable.`;
  }

  private formatLateDeliveryNote(scheduledFireAt: number, deliveredAt: number): string {
    if (deliveredAt - scheduledFireAt <= LATE_TIMER_THRESHOLD_MS) return "";
    return `\n\nThis timer was initially scheduled to fire at ${new Date(scheduledFireAt).toISOString()}.`;
  }

  // ── Browser sync ───────────────────────────────────────────────────────────

  /** Broadcast current timer list for a session to all connected browsers. */
  private broadcastTimers(sessionId: string): void {
    const timers = this.sessions.get(sessionId)?.timers ?? [];
    const msg: BrowserIncomingMessage = { type: "timer_update", timers };
    this.wsBridge.broadcastToSession(sessionId, msg);
  }

  // ── Persistence helpers ────────────────────────────────────────────────────

  /** Get the in-memory file for a session, loading from disk to recover nextId
   *  if this session had timers previously. Falls back to a fresh file. */
  private async getOrCreateFile(sessionId: string): Promise<SessionTimerFile> {
    let file = this.sessions.get(sessionId);
    if (!file) {
      // Try loading from disk -- recovers nextId even after all timers were removed
      file = await timerStore.loadTimers(sessionId);
      this.sessions.set(sessionId, file);
    }
    return file;
  }

  private async persistAndEvictIfEmptyNow(sessionId: string): Promise<void> {
    await this.persistSessionNow(sessionId);
    const file = this.sessions.get(sessionId);
    if (file && file.timers.length === 0) this.sessions.delete(sessionId);
  }

  private async persistSessionNow(sessionId: string): Promise<void> {
    const file = this.sessions.get(sessionId);
    if (!file) return;
    // Serialize snapshots so an older asynchronous write cannot overwrite the final timer state.
    const snapshot = structuredClone(file);
    const prior = this.writeChains.get(sessionId) ?? Promise.resolve();
    const write = prior.catch(() => {}).then(() => timerStore.saveTimers(snapshot));
    this.writeChains.set(sessionId, write);
    this.pendingWrites.add(write);
    try {
      await write;
      this.writeFailures.delete(sessionId);
    } catch (error) {
      this.writeFailures.set(sessionId, error);
      throw error;
    } finally {
      this.pendingWrites.delete(write);
      if (this.writeChains.get(sessionId) === write) this.writeChains.delete(sessionId);
    }
  }
}

/** `text` in a Markdown code fence longer than any backtick run inside it, ending with a newline. */
function fenced(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `\n${fence}\n${text}\n${fence}\n`;
}
