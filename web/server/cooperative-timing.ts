type TimingLogger = Pick<Console, "info" | "warn">;

export interface CooperativeTimingOptions {
  label: string;
  summaryThresholdMs?: number;
  stepWarnThresholdMs?: number;
  yieldEveryMs?: number;
  logger?: TimingLogger;
  now?: () => number;
  yieldFn?: () => Promise<void>;
}

interface TimingStep {
  name: string;
  ms: number;
  failed: boolean;
}

interface TimingYield {
  reason: string;
  ms: number;
}

const DEFAULT_SUMMARY_THRESHOLD_MS = 250;
const DEFAULT_STEP_WARN_THRESHOLD_MS = 200;
const DEFAULT_YIELD_EVERY_MS = 40;

export class CooperativeTiming {
  private readonly startedAt: number;
  private lastYieldAt: number;
  private readonly steps: TimingStep[] = [];
  private readonly yields: TimingYield[] = [];
  private finished = false;

  constructor(private readonly options: CooperativeTimingOptions) {
    this.startedAt = this.now();
    this.lastYieldAt = this.startedAt;
  }

  async step<T>(name: string, fn: () => T | Promise<T>): Promise<T> {
    const startedAt = this.now();
    let failed = false;
    try {
      return await fn();
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      const ms = this.now() - startedAt;
      this.steps.push({ name, ms, failed });
      if (ms >= this.stepWarnThresholdMs) {
        this.logger.warn(`[timing] ${this.options.label}: slow step ${name} ${Math.round(ms)}ms`);
      }
      await this.yieldIfDue(name);
    }
  }

  async yieldIfDue(reason: string): Promise<boolean> {
    const elapsedSinceYield = this.now() - this.lastYieldAt;
    if (elapsedSinceYield < this.yieldEveryMs) return false;

    const startedAt = this.now();
    await this.yieldFn();
    const ms = this.now() - startedAt;
    this.lastYieldAt = this.now();
    this.yields.push({ reason, ms });
    return true;
  }

  finish(extra?: Record<string, string | number | boolean | null | undefined>): void {
    if (this.finished) return;
    this.finished = true;

    const totalMs = this.now() - this.startedAt;
    const shouldLog =
      totalMs >= this.summaryThresholdMs || this.steps.some((step) => step.ms >= this.stepWarnThresholdMs);
    if (!shouldLog) return;

    const stepSummary = this.steps
      .map((step) => `${step.name}=${Math.round(step.ms)}ms${step.failed ? ":failed" : ""}`)
      .join(", ");
    const yieldSummary =
      this.yields.length > 0
        ? ` yields=${this.yields.length}/${Math.round(this.yields.reduce((sum, item) => sum + item.ms, 0))}ms`
        : "";
    const extraSummary = extra
      ? Object.entries(extra)
          .filter((entry): entry is [string, string | number | boolean | null] => entry[1] !== undefined)
          .map(([key, value]) => `${key}=${String(value)}`)
          .join(" ")
      : "";
    const suffix = [stepSummary, yieldSummary.trim(), extraSummary].filter(Boolean).join(" | ");
    this.logger.info(`[timing] ${this.options.label}: total=${Math.round(totalMs)}ms${suffix ? ` | ${suffix}` : ""}`);
  }

  get recordedYieldCountForTest(): number {
    return this.yields.length;
  }

  private get logger(): TimingLogger {
    return this.options.logger ?? console;
  }

  private get summaryThresholdMs(): number {
    return this.options.summaryThresholdMs ?? DEFAULT_SUMMARY_THRESHOLD_MS;
  }

  private get stepWarnThresholdMs(): number {
    return this.options.stepWarnThresholdMs ?? DEFAULT_STEP_WARN_THRESHOLD_MS;
  }

  private get yieldEveryMs(): number {
    return this.options.yieldEveryMs ?? DEFAULT_YIELD_EVERY_MS;
  }

  private now(): number {
    return this.options.now ? this.options.now() : performance.now();
  }

  private yieldFn(): Promise<void> {
    if (this.options.yieldFn) return this.options.yieldFn();
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
}
