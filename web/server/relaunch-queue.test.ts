import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RelaunchQueue } from "./relaunch-queue.js";

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("RelaunchQueue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not relaunch a replacement for overlapping automatic recovery demand", async () => {
    // Automatic recovery is satisfied by the in-flight launch. An explicit
    // settings change still needs the trailing launch and must not be dropped.
    let release!: () => void;
    const run = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    const queue = new RelaunchQueue(run, 100);
    queue.request("leader", { trailing: false });
    queue.request("leader", { trailing: false });
    release();
    await flushMicrotasks();
    queue.request("leader", { trailing: false });
    await vi.advanceTimersByTimeAsync(100);
    expect(run).toHaveBeenCalledTimes(1);
    queue.request("leader", { trailing: false });
    queue.request("leader");
    release();
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(100);
    expect(run).toHaveBeenCalledTimes(3);
    release();
  });

  it("coalesces repeated requests into one trailing relaunch after cooldown", async () => {
    let resolveFirst: (() => void) | null = null;
    let callCount = 0;
    const runRelaunch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        await new Promise<void>((resolve) => {
          resolveFirst = resolve;
        });
      }
    });
    const queue = new RelaunchQueue(runRelaunch, 100);

    queue.request("s1");
    queue.request("s1");
    queue.request("s1");
    expect(runRelaunch).toHaveBeenCalledTimes(1);

    expect(resolveFirst).toBeTypeOf("function");
    resolveFirst!();
    await flushMicrotasks();

    vi.advanceTimersByTime(99);
    await flushMicrotasks();
    expect(runRelaunch).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    await flushMicrotasks();
    expect(runRelaunch).toHaveBeenCalledTimes(2);
  });

  it("queues requests that arrive during cooldown and runs once cooldown expires", async () => {
    const runRelaunch = vi.fn(async () => {});
    const queue = new RelaunchQueue(runRelaunch, 100);

    queue.request("s1");
    await flushMicrotasks();
    expect(runRelaunch).toHaveBeenCalledTimes(1);

    queue.request("s1");
    await flushMicrotasks();
    expect(runRelaunch).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(100);
    await flushMicrotasks();
    expect(runRelaunch).toHaveBeenCalledTimes(2);
  });

  it("keeps relaunch scheduling isolated per session", async () => {
    let resolveS1: (() => void) | null = null;
    const runRelaunch = vi.fn(async (sessionId: string) => {
      if (sessionId === "s1") {
        await new Promise<void>((resolve) => {
          resolveS1 = resolve;
        });
      }
    });
    const queue = new RelaunchQueue(runRelaunch, 100);

    queue.request("s1");
    queue.request("s2");

    await flushMicrotasks();
    expect(runRelaunch).toHaveBeenCalledTimes(2);
    expect(runRelaunch).toHaveBeenNthCalledWith(1, "s1");
    expect(runRelaunch).toHaveBeenNthCalledWith(2, "s2");

    expect(resolveS1).toBeTypeOf("function");
    resolveS1!();
    await flushMicrotasks();
  });
});
