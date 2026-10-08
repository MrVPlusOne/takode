import { afterEach, describe, expect, it, vi } from "vitest";
import { ServerShutdown, type ServerShutdownOptions } from "./server-shutdown.js";
import { ServerWorkAdmission } from "./server-work-admission.js";
import { waitForBackendShutdown } from "./supervised-backend-shutdown.js";

function gate<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function setup(overrides: Partial<ServerShutdownOptions> = {}) {
  const admission = new ServerWorkAdmission();
  const options = {
    admission,
    stopWork: vi.fn(),
    settleWork: () => admission.drain(),
    cancelFrontendPreparation: vi.fn(async () => {}),
    stopSessions: vi.fn(async () => {}),
    stopListener: vi.fn(async () => {}),
    persist: vi.fn(async () => {}),
    cleanupFrontend: vi.fn(async () => {}),
    flushLogs: vi.fn(async () => {}),
    log: vi.fn(),
    exit: vi.fn(),
    stageTimeoutMs: 20,
    ...overrides,
  };
  return { admission, options, shutdown: new ServerShutdown(options) };
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("server shutdown", () => {
  it("stops admission synchronously, drains accepted work, and exits only after saving", async () => {
    // Work accepted before the boundary may still be handing off pending input asynchronously.
    const accepted = gate<void>();
    const saved = gate<void>();
    const h = setup({ persist: vi.fn(() => saved.promise) });
    h.admission.track(accepted.promise);
    const operation = h.shutdown.request(42);
    expect(h.admission.isStopping()).toBe(true);
    expect(h.options.stopWork).toHaveBeenCalledOnce();
    expect(() => h.admission.assertOpen()).toThrow("shutting down");
    expect(h.shutdown.request(0)).toBe(operation);
    await vi.waitFor(() => expect(h.options.stopListener).toHaveBeenCalled());
    expect(h.options.persist).not.toHaveBeenCalled();
    accepted.resolve();
    await vi.waitFor(() => expect(h.options.persist).toHaveBeenCalled());
    expect(h.options.exit).not.toHaveBeenCalled();
    saved.resolve();
    await operation;
    expect(h.options.cleanupFrontend).toHaveBeenCalledOnce();
    expect(h.options.exit).toHaveBeenCalledExactlyOnceWith(42);
  });

  it("stops node-run sessions before closing the listener on a stop, and keeps them on a restart", async () => {
    // A stop must reach the nodes while their links are still open; a restart
    // leaves the sessions running for the next server to take over.
    const order: string[] = [];
    const stop = setup({
      stopSessions: vi.fn(async () => {
        order.push("sessions");
      }),
      stopListener: vi.fn(async () => {
        order.push("listener");
      }),
    });
    await stop.shutdown.request(0);
    expect(order).toEqual(["sessions", "listener"]);

    const restart = setup();
    await restart.shutdown.request(42);
    expect(restart.options.stopSessions).not.toHaveBeenCalled();
    expect(restart.options.exit).toHaveBeenCalledWith(42);
  });

  it("continues after a stuck listener but preserves its frontend until process exit", async () => {
    // Bun can leave stop(true) pending after server-side WebSocket close; it must not block saves.
    vi.useFakeTimers();
    const listener = gate<void>();
    const h = setup({ stopListener: () => listener.promise });
    const operation = h.shutdown.request(42);
    await vi.advanceTimersByTimeAsync(21);
    await operation;
    expect(h.options.persist).toHaveBeenCalledTimes(2);
    expect(h.options.cleanupFrontend).not.toHaveBeenCalled();
    expect(h.options.exit).toHaveBeenCalledWith(42);
    listener.resolve();
    await Promise.resolve();
    expect(h.options.cleanupFrontend).not.toHaveBeenCalled();
  });

  it.each(["reject", "stall"])("holds the inactive process when persistence %ss", async (kind) => {
    // Repeated restart/signal requests cannot turn the approved preservation exception into a forced exit.
    vi.useFakeTimers();
    const save = gate<void>();
    const h = setup({ persist: () => save.promise });
    const operation = h.shutdown.request(42);
    await vi.advanceTimersByTimeAsync(1);
    if (kind === "reject") save.reject(new Error("disk unavailable"));
    await vi.advanceTimersByTimeAsync(100);
    expect(h.options.exit).not.toHaveBeenCalled();
    expect(h.options.cleanupFrontend).not.toHaveBeenCalled();
    expect(h.options.log).toHaveBeenCalledWith(
      expect.stringContaining("blocked"),
      expect.objectContaining({ stage: "persistence" }),
    );
    expect(h.shutdown.request(0)).toBe(operation);
    if (kind === "stall") {
      save.resolve();
      await operation;
      expect(h.options.exit).toHaveBeenCalledWith(42);
    } else await operation;
  });

  it("saves output received during cleanup again immediately before exit", async () => {
    // Already-running backends can finish while a bounded cleanup is awaiting I/O.
    let pending = "before cleanup";
    let saved = "";
    const h = setup({
      persist: async () => {
        saved = pending;
      },
      cleanupFrontend: async () => {
        pending = "late backend output";
      },
      exit: () => {
        expect(saved).toBe("late backend output");
      },
    });
    await h.shutdown.request(42);
  });

  it("does not let a second supervisor start until the known backend has actually exited", async () => {
    vi.useFakeTimers();
    const exited = gate<number>();
    const backend = { kill: vi.fn(), exited: exited.promise };
    const warning = vi.fn();
    const successor = vi.fn();
    const operation = waitForBackendShutdown(backend, warning, 20).then(successor);
    await vi.advanceTimersByTimeAsync(100);
    expect(backend.kill).toHaveBeenCalledExactlyOnceWith("SIGTERM");
    expect(warning).toHaveBeenCalledOnce();
    expect(successor).not.toHaveBeenCalled();
    exited.resolve(42);
    await operation;
    expect(successor).toHaveBeenCalledOnce();
  });
});
