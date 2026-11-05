import { spawn, type ChildProcess } from "node:child_process";

/**
 * Keeps this Mac awake with macOS `caffeinate -t <seconds>`. Each call to
 * {@link keepAwakeFor} restarts the countdown, so calling it about every minute
 * while there is work keeps the machine awake, and it may sleep that long after
 * the calls stop. Does nothing on other platforms. Used by the server for its own
 * machine and by `takode node` for the machine it runs on.
 */
export class Caffeinate {
  private proc: ChildProcess | null = null;

  constructor(
    private readonly log: (message: string) => void = (message) => console.warn(`[sleep-inhibitor] ${message}`),
  ) {}

  /** Whether this machine can be kept awake (macOS). */
  get supported(): boolean {
    return process.platform === "darwin";
  }

  keepAwakeFor(seconds: number): void {
    if (!this.supported || !(seconds > 0)) return;
    this.stop();
    try {
      const proc = spawn("caffeinate", ["-t", String(Math.round(seconds))], { stdio: "ignore", detached: false });
      const forget = () => {
        if (this.proc !== proc) return;
        this.proc = null;
      };
      proc.on("exit", forget);
      proc.on("error", (err) => {
        this.log(`Failed to spawn caffeinate: ${err.message}`);
        forget();
      });
      // Don't let the caffeinate process keep the event loop alive on shutdown.
      proc.unref();
      this.proc = proc;
    } catch (err) {
      this.log(`caffeinate spawn error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Let the machine sleep again now. */
  stop(): void {
    const proc = this.proc;
    if (!proc) return;
    this.proc = null;
    try {
      if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGTERM");
    } catch {
      // Process already exited -- safe to ignore.
    }
  }
}
