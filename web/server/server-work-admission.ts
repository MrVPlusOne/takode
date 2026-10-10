/** Process-local admission boundary; it does not claim ownership of shared state. */
export class ServerWorkAdmission {
  private stopping = false;
  private preservingQueuedWork = false;
  /** Accepted operations still running, with what each one is. */
  private pending = new Map<Promise<unknown>, string>();
  /** Running operations a shutdown stopped waiting for. */
  private abandoned = new Set<Promise<unknown>>();

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

  /**
   * Retain an already accepted operation until it has handed off its pending
   * state. `label` says what it is in shutdown logs, e.g. "relaunch of session abc".
   */
  track<T>(operation: Promise<T>, label: string): Promise<T> {
    this.pending.set(operation, label);
    void operation
      .finally(() => {
        this.pending.delete(operation);
        this.abandoned.delete(operation);
      })
      .catch(() => {});
    return operation;
  }

  /** Labels of the accepted work still waited for, oldest first. */
  pendingLabels(): string[] {
    return this.waiting().map((operation) => this.pending.get(operation)!);
  }

  /**
   * Wait for accepted work, including work accepted meanwhile, for at most
   * `timeoutMs`. Work still running then may wait on something that never
   * answers, such as a host that cannot reconnect, so it is abandoned: later
   * calls no longer wait for it. Returns the labels of the abandoned work.
   */
  async settle(timeoutMs: number): Promise<string[]> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), timeoutMs);
    });
    try {
      for (let waiting = this.waiting(); waiting.length > 0; waiting = this.waiting()) {
        if ((await Promise.race([Promise.allSettled(waiting), deadline])) !== "timeout") continue;
        const labels = this.pendingLabels();
        for (const operation of this.waiting()) this.abandoned.add(operation);
        return labels;
      }
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  private waiting(): Promise<unknown>[] {
    return [...this.pending.keys()].filter((operation) => !this.abandoned.has(operation));
  }
}

export const serverWorkAdmission = new ServerWorkAdmission();
