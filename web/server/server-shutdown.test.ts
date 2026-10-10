import { afterEach, describe, expect, it, vi } from "vitest";
import { HostLinkManager } from "./remote-host/host-link-manager.js";
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
    cancelFrontendPreparation: vi.fn(async () => {}),
    stopSessions: vi.fn(async () => {}),
    stopListener: vi.fn(async () => {}),
    persist: vi.fn(async () => {}),
    cleanupFrontend: vi.fn(async () => {}),
    flushLogs: vi.fn(async () => {}),
    log: vi.fn(),
    exit: vi.fn(),
    stageTimeoutMs: 20,
    acceptedWorkTimeoutMs: 100,
    ...overrides,
  };
  return { admission, options, shutdown: new ServerShutdown(options) };
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("server shutdown", () => {
  it("stops admission synchronously, settles accepted work before closing the listener, and exits only after saving", async () => {
    // Work accepted before the boundary may still be handing off pending input asynchronously,
    // possibly waiting on a node that can answer only while the listener serves its link.
    const accepted = gate<void>();
    const saved = gate<void>();
    const h = setup({ persist: vi.fn(() => saved.promise) });
    h.admission.track(accepted.promise, "relaunch of session s1");
    const operation = h.shutdown.request(42);
    expect(h.admission.isStopping()).toBe(true);
    expect(h.options.stopWork).toHaveBeenCalledOnce();
    expect(() => h.admission.assertOpen()).toThrow("shutting down");
    expect(h.shutdown.request(0)).toBe(operation);
    await vi.waitFor(() =>
      expect(h.options.log).toHaveBeenCalledWith("Shutdown stage started", { stage: "accepted-work" }),
    );
    expect(h.options.stopListener).not.toHaveBeenCalled();
    accepted.resolve();
    await vi.waitFor(() => expect(h.options.persist).toHaveBeenCalled());
    expect(h.options.stopListener).toHaveBeenCalledOnce();
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

  it("completes a restart whose accepted work waits forever on a host link, naming what it gave up", async () => {
    // The Oct 9 incident: a restart accepted work that waited on a node that could
    // never answer (the host was offline), and the accepted-work stage waited forever.
    // Here a relaunch waits for its process to start on an offline host, which never happens.
    vi.useFakeTimers();
    const links = new HostLinkManager();
    const proc = links.spawn("laptop", { command: "claude", args: [], env: {} });
    const started = new Promise<void>((resolve) => proc.once("spawn", () => resolve()));
    const h = setup();
    h.admission.track(started, "relaunch of session s1");
    const operation = h.shutdown.request(42);

    // While it waits, the log says what it waits on.
    await vi.advanceTimersByTimeAsync(50);
    expect(h.options.log).toHaveBeenCalledWith("Shutdown stage waiting", {
      stage: "accepted-work",
      pending: ["relaunch of session s1"],
    });
    expect(h.options.stopListener).not.toHaveBeenCalled();

    // After its budget the work is abandoned, and the later stages do not wait for it again.
    await vi.advanceTimersByTimeAsync(60);
    await operation;
    expect(h.options.log).toHaveBeenCalledWith("Shutdown stage timed out; abandoning accepted work", {
      stage: "accepted-work",
      pending: ["relaunch of session s1"],
    });
    expect(h.options.persist).toHaveBeenCalledTimes(2);
    expect(h.options.exit).toHaveBeenCalledExactlyOnceWith(42);
    expect(h.admission.pendingLabels()).toEqual([]);
  });

  it("waits for accepted work started after the first settle before each save", async () => {
    // Backend output handled during the listener stage can accept more work; the save after it waits for it.
    const late = gate<void>();
    const h = setup({
      stopListener: vi.fn(async () => {
        h.admission.track(late.promise, "browser user_message for session s1");
      }),
    });
    const operation = h.shutdown.request(42);
    await vi.waitFor(() => expect(h.options.stopListener).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(h.options.persist).not.toHaveBeenCalled();
    late.resolve();
    await operation;
    expect(h.options.persist).toHaveBeenCalledTimes(2);
    expect(h.options.exit).toHaveBeenCalledWith(42);
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
