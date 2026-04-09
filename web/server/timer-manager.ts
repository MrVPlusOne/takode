import type { WsBridge } from "./ws-bridge.js";
import type { SessionTimer, SessionTimerFile, TimerCreateInput } from "./timer-types.js";
import { resolveTimerSchedule } from "./timer-parse.js";
import * as timerStore from "./timer-store.js";

const SWEEP_INTERVAL_MS = 5_000;
const LOG_TAG = "[timer-manager]";

export class TimerManager {
  /** In-memory cache: sessionId -> SessionTimerFile */
  private sessions = new Map<string, SessionTimerFile>();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private wsBridge: WsBridge) {}

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
    this.stopSweep();
    this.sessions.clear();
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────

  /** Create a new timer for a session. Returns the created timer. */
  async createTimer(sessionId: string, input: TimerCreateInput): Promise<SessionTimer> {
    if (!input.prompt?.trim()) throw new Error("Timer prompt is required");

    const schedule = resolveTimerSchedule(input);
    const file = this.getOrCreateFile(sessionId);
    const id = `t${file.nextId++}`;

    const timer: SessionTimer = {
      id,
      sessionId,
      prompt: input.prompt.trim(),
      type: schedule.type,
      originalSpec: schedule.originalSpec,
      nextFireAt: schedule.nextFireAt,
      intervalMs: schedule.intervalMs,
      createdAt: Date.now(),
      fireCount: 0,
    };

    file.timers.push(timer);
    this.persistSession(sessionId);
    this.broadcastTimers(sessionId);

    console.log(
      `${LOG_TAG} Created timer ${id} for session ${sessionId.slice(0, 8)} ` +
        `(${timer.type}, fires ${new Date(timer.nextFireAt).toISOString()})`,
    );

    return timer;
  }

  /** Cancel (delete) a timer. Returns true if found and removed. */
  async cancelTimer(sessionId: string, timerId: string): Promise<boolean> {
    const file = this.sessions.get(sessionId);
    if (!file) return false;

    const idx = file.timers.findIndex((t) => t.id === timerId);
    if (idx === -1) return false;

    file.timers.splice(idx, 1);

    if (file.timers.length === 0) {
      this.sessions.delete(sessionId);
      timerStore.deleteTimers(sessionId).catch((err) => {
        console.error(`${LOG_TAG} Failed to delete timer file for ${sessionId.slice(0, 8)}:`, err);
      });
    } else {
      this.persistSession(sessionId);
    }

    this.broadcastTimers(sessionId);

    console.log(`${LOG_TAG} Cancelled timer ${timerId} for session ${sessionId.slice(0, 8)}`);
    return true;
  }

  /** List all active timers for a session. */
  listTimers(sessionId: string): SessionTimer[] {
    return this.sessions.get(sessionId)?.timers ?? [];
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

  // ── Sweep ──────────────────────────────────────────────────────────────────

  private startSweep(): void {
    this.stopSweep();
    this.sweepTimer = setInterval(() => {
      void this.sweep();
    }, SWEEP_INTERVAL_MS);
  }

  private stopSweep(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  /** Check all timers, fire any that are due. */
  private async sweep(): Promise<void> {
    const now = Date.now();

    for (const [sessionId, file] of this.sessions) {
      const toRemove: string[] = [];
      let changed = false;

      for (const timer of file.timers) {
        if (timer.nextFireAt > now) continue;

        // Timer is due -- fire it
        this.fireTimer(sessionId, timer);

        if (timer.type === "recurring" && timer.intervalMs) {
          // Advance past now (catchup: skip missed intervals, fire only once)
          while (timer.nextFireAt <= now) {
            timer.nextFireAt += timer.intervalMs;
          }
          timer.lastFiredAt = now;
          timer.fireCount++;
          changed = true;
        } else {
          // One-shot (delay or at): remove after firing
          timer.lastFiredAt = now;
          timer.fireCount++;
          toRemove.push(timer.id);
          changed = true;
        }
      }

      // Remove fired one-shot timers
      if (toRemove.length > 0) {
        file.timers = file.timers.filter((t) => !toRemove.includes(t.id));
        if (file.timers.length === 0) {
          this.sessions.delete(sessionId);
          timerStore.deleteTimers(sessionId).catch((err) => {
            console.error(`${LOG_TAG} Failed to delete timer file for ${sessionId.slice(0, 8)}:`, err);
          });
        }
      }

      if (changed) {
        if (this.sessions.has(sessionId)) {
          this.persistSession(sessionId);
        }
        this.broadcastTimers(sessionId);
      }
    }
  }

  /** Fire a single timer: inject user message into the session. */
  private fireTimer(sessionId: string, timer: SessionTimer): void {
    const content = `[⏰ Timer ${timer.id}] ${timer.prompt}`;
    const result = this.wsBridge.injectUserMessage(sessionId, content, {
      sessionId: `timer:${timer.id}`,
      sessionLabel: `Timer ${timer.id}`,
    });
    console.log(
      `${LOG_TAG} Fired timer ${timer.id} for session ${sessionId.slice(0, 8)}: ${result}`,
    );
  }

  // ── Browser sync ───────────────────────────────────────────────────────────

  /** Broadcast current timer list for a session to all connected browsers. */
  private broadcastTimers(sessionId: string): void {
    const timers = this.sessions.get(sessionId)?.timers ?? [];
    this.wsBridge.broadcastToSession(sessionId, {
      type: "timer_update",
      timers,
    } as any);
  }

  // ── Persistence helpers ────────────────────────────────────────────────────

  /** Get the in-memory file for a session, or create an empty one. */
  private getOrCreateFile(sessionId: string): SessionTimerFile {
    let file = this.sessions.get(sessionId);
    if (!file) {
      file = { sessionId, nextId: 1, timers: [] };
      this.sessions.set(sessionId, file);
    }
    return file;
  }

  /** Save session timer state to disk (fire-and-forget). */
  private persistSession(sessionId: string): void {
    const file = this.sessions.get(sessionId);
    if (!file) return;
    timerStore.saveTimers(file).catch((err) => {
      console.error(`${LOG_TAG} Failed to persist timers for ${sessionId.slice(0, 8)}:`, err);
    });
  }
}
