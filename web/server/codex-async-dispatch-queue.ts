/** Serializes Codex adapter side effects while exposing queued/in-flight work to idle-only controllers. */
export class CodexAsyncDispatchQueue {
  private chain: Promise<void> = Promise.resolve();
  private pendingCount = 0;

  constructor(
    private readonly onError: (label: string, error: unknown) => void,
    private readonly onSettled: () => void,
  ) {}

  hasPending(): boolean {
    return this.pendingCount > 0;
  }

  enqueue(label: string, run: () => Promise<void>): void {
    this.pendingCount += 1;
    this.chain = this.chain
      .then(async () => {
        try {
          await run();
        } finally {
          this.pendingCount = Math.max(0, this.pendingCount - 1);
          this.onSettled();
        }
      })
      .catch((error) => this.onError(label, error));
  }
}
