/** Process-local admission boundary; it does not claim ownership of shared state. */
export class ServerWorkAdmission {
  private stopping = false;
  private preservingQueuedWork = false;
  private pending = new Set<Promise<unknown>>();

  isStopping(): boolean {
    return this.stopping;
  }

  stop(): void {
    this.stopping = true;
  }

  /** Permit only synchronous transfer of existing buffered work into durable queues, never dispatch. */
  preserveQueuedWork(operation: () => void): void {
    if (!this.isStopping()) throw new Error("Queue preservation requires shutdown");
    this.preservingQueuedWork = true;
    try {
      operation();
    } finally {
      this.preservingQueuedWork = false;
    }
  }

  isPreservingQueuedWork(): boolean {
    return this.preservingQueuedWork;
  }

  assertOpen(): void {
    if (this.isStopping()) throw new Error("Server is shutting down; new work is not accepted");
  }

  /** Retain already accepted operations until they have handed off their pending state. */
  track<T>(operation: Promise<T>): Promise<T> {
    this.pending.add(operation);
    void operation.finally(() => this.pending.delete(operation)).catch(() => {});
    return operation;
  }

  async drain(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
  }
}

export const serverWorkAdmission = new ServerWorkAdmission();
