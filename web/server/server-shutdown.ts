import { RESTART_EXIT_CODE } from "./constants.js";
import { serverWorkAdmission, type ServerWorkAdmission } from "./server-work-admission.js";

/**
 * How long a shutdown waits for work it already accepted. Such work can wait on
 * something that never answers, such as a node that cannot reconnect, and must
 * not hold the restart forever.
 */
const ACCEPTED_WORK_TIMEOUT_MS = 30_000;

export interface ServerShutdownOptions {
  /** Stop the producers of new work; work they still finish should be tracked by the admission. */
  stopWork: () => void;
  cancelFrontendPreparation: () => Promise<void>;
  /**
   * End the sessions whose processes outlive this server under a node. Only a
   * stop does this; a restart leaves them running for the next server to take over.
   */
  stopSessions: () => Promise<void>;
  stopListener: () => Promise<void>;
  persist: () => Promise<void>;
  cleanupFrontend: () => Promise<void>;
  flushLogs: () => Promise<void>;
  log: (message: string, details: Record<string, unknown>) => void;
  exit: (code: number) => void;
  admission?: ServerWorkAdmission;
  stageTimeoutMs?: number;
  acceptedWorkTimeoutMs?: number;
}

/** One shutdown operation for signals and requested restarts, with a persistence-first exit gate. */
export class ServerShutdown {
  private operation: Promise<void> | null = null;
  private readonly admission: ServerWorkAdmission;
  private readonly timeoutMs: number;
  private readonly acceptedWorkTimeoutMs: number;

  constructor(private readonly options: ServerShutdownOptions) {
    this.admission = options.admission ?? serverWorkAdmission;
    this.timeoutMs = options.stageTimeoutMs ?? 5_000;
    this.acceptedWorkTimeoutMs = options.acceptedWorkTimeoutMs ?? ACCEPTED_WORK_TIMEOUT_MS;
  }

  request(exitCode: number): Promise<void> {
    if (this.operation) return this.operation;
    this.admission.stop();
    // Producers stop synchronously, before listener shutdown can block or fire close callbacks.
    this.options.stopWork();
    this.operation = this.finish(exitCode);
    return this.operation;
  }

  private async finish(exitCode: number): Promise<void> {
    await this.bounded("frontend-preparation", this.options.cancelFrontendPreparation);
    // Before the listener closes, while the nodes are still connected to receive the stop.
    if (exitCode !== RESTART_EXIT_CODE) await this.bounded("sessions", this.options.stopSessions);
    // Accepted work may wait on a node, which answers only while the listener serves its link.
    await this.settleAcceptedWork();
    const listenerStopped = await this.bounded("listener", this.options.stopListener);
    // Backends keep producing output through the later stages, and handling it can accept more work.
    await this.settleAcceptedWork();
    if (!(await this.preservationBarrier("persistence", this.options.persist))) return;
    if (listenerStopped) await this.bounded("frontend-cleanup", this.options.cleanupFrontend);
    await this.bounded("log-flush", this.options.flushLogs);
    await this.settleAcceptedWork();
    // An existing backend may finish output while cleanup/log I/O runs. No await may follow this save.
    if (!(await this.preservationBarrier("final-persistence", this.options.persist))) return;
    this.options.log("Shutdown complete", { exitCode });
    this.options.exit(exitCode);
  }

  private async bounded(stage: string, operation: () => Promise<void>): Promise<boolean> {
    this.options.log("Shutdown stage started", { stage });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const completed = await Promise.race([
        Promise.resolve()
          .then(operation)
          .then(() => true),
        new Promise<false>((resolve) => {
          timer = setTimeout(() => resolve(false), this.timeoutMs);
        }),
      ]);
      this.options.log(completed ? "Shutdown stage completed" : "Shutdown stage timed out", { stage });
      return completed;
    } catch (error) {
      this.options.log("Shutdown stage failed", { stage, error: String(error) });
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Let accepted work hand off its pending state, logging what it waits on and what it gives up. */
  private async settleAcceptedWork(): Promise<void> {
    const stage = "accepted-work";
    this.options.log("Shutdown stage started", { stage });
    const report = setInterval(() => {
      this.options.log("Shutdown stage waiting", { stage, pending: this.admission.pendingLabels() });
    }, this.timeoutMs);
    try {
      const abandoned = await this.admission.settle(this.acceptedWorkTimeoutMs);
      if (abandoned.length === 0) this.options.log("Shutdown stage completed", { stage });
      else this.options.log("Shutdown stage timed out; abandoning accepted work", { stage, pending: abandoned });
    } finally {
      clearInterval(report);
    }
  }

  private async preservationBarrier(stage: string, operation: () => Promise<void>): Promise<boolean> {
    this.options.log("Shutdown stage started", { stage });
    // A referenced timer keeps the inactive process alive even if the stalled save has no handles.
    const hold = setInterval(() => {
      this.options.log("Shutdown blocked; preserving pending state and waiting before replacement", { stage });
    }, this.timeoutMs);
    try {
      await operation();
      clearInterval(hold);
      this.options.log("Shutdown stage completed", { stage });
      return true;
    } catch (error) {
      this.options.log("Shutdown blocked; state was not saved, automatic replacement is blocked", {
        stage,
        error: String(error),
      });
      // Intentionally retain the timer and process. Repeated signals cannot bypass failed persistence.
      return false;
    }
  }
}
