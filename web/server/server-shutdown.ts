import { serverWorkAdmission, type ServerWorkAdmission } from "./server-work-admission.js";

export interface ServerShutdownOptions {
  stopWork: () => void;
  settleWork: () => Promise<void>;
  cancelFrontendPreparation: () => Promise<void>;
  stopListener: () => Promise<void>;
  persist: () => Promise<void>;
  cleanupFrontend: () => Promise<void>;
  flushLogs: () => Promise<void>;
  log: (message: string, details: Record<string, unknown>) => void;
  exit: (code: number) => void;
  admission?: ServerWorkAdmission;
  stageTimeoutMs?: number;
}

/** One shutdown operation for signals and requested restarts, with a persistence-first exit gate. */
export class ServerShutdown {
  private operation: Promise<void> | null = null;
  private readonly admission: ServerWorkAdmission;
  private readonly timeoutMs: number;

  constructor(private readonly options: ServerShutdownOptions) {
    this.admission = options.admission ?? serverWorkAdmission;
    this.timeoutMs = options.stageTimeoutMs ?? 5_000;
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
    const listenerStopped = await this.bounded("listener", this.options.stopListener);
    if (!(await this.preservationBarrier("accepted-work", this.options.settleWork))) return;
    if (!(await this.preservationBarrier("persistence", this.options.persist))) return;
    if (listenerStopped) await this.bounded("frontend-cleanup", this.options.cleanupFrontend);
    await this.bounded("log-flush", this.options.flushLogs);
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
