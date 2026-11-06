import type { InputTraceBatch } from "../../shared/input-trace.js";

/** Uploads numbered batches, retrying unacknowledged events while this recording stays open. */
export class InputTraceUpload {
  private savedThrough = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = 0;
  private stopped = false;

  constructor(
    private readonly batch: (after: number) => InputTraceBatch,
    private readonly status: (result: { at: number; error?: string }) => void,
  ) {}

  schedule(): void {
    if (!this.stopped && !this.timer) this.timer = setTimeout(() => this.flush(), 1000);
  }

  /** pagehide may overlap a normal request; sequence numbers make duplicate delivery harmless. */
  flush(keepalive = false): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.stopped || (this.inFlight && !keepalive)) return;
    const batch = this.batch(this.savedThrough);
    if (!batch.events.length) return;
    this.inFlight += 1;
    void fetch("/api/diagnostics/input-trace/batches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(batch),
      keepalive,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`Could not save input trace (${response.status})`);
        this.savedThrough = Math.max(this.savedThrough, batch.events[batch.events.length - 1].seq);
        if (!this.stopped) this.status({ at: Date.now() });
      })
      .catch((error: unknown) => {
        if (!this.stopped) {
          console.warn("[input-trace] Automatic save failed; retrying:", error);
          this.status({ at: Date.now(), error: error instanceof Error ? error.message : String(error) });
        }
      })
      .finally(() => {
        this.inFlight -= 1;
        if (this.batch(this.savedThrough).events.length) this.schedule();
      });
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
