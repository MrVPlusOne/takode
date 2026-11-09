import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SessionTimerFile, TimerCheckResult } from "./timer-types.js";

// Timers with a check: the server runs the check at each tick instead of
// waking the session, and wakes it only when the check passes or after
// `wakeEvery` checks that did not (so a wrong check cannot keep it asleep).

const mockFiles = new Map<string, SessionTimerFile>();

// Keep timer persistence in memory so these tests never touch disk.
vi.mock("./timer-store.js", () => ({
  loadTimers: vi.fn(async (sessionId: string) => mockFiles.get(sessionId) ?? { sessionId, nextId: 1, timers: [] }),
  saveTimers: vi.fn(async (data: SessionTimerFile) => {
    mockFiles.set(data.sessionId, JSON.parse(JSON.stringify(data)));
  }),
  deleteTimers: vi.fn(async (sessionId: string) => {
    mockFiles.delete(sessionId);
  }),
  listTimerSessions: vi.fn(async () => [...mockFiles.keys()]),
  getTimerDir: vi.fn(() => "/tmp/mock-timers"),
}));

import { TimerManager, type TimerCheckRunner } from "./timer-manager.js";
import { isTimerReminderFiring } from "./bridge/adapter-browser-routing-timer.js";

type CheckOutcome = Omit<TimerCheckResult, "at">;

const START = new Date("2026-11-08T12:00:00Z").getTime();
const MINUTE = 60_000;

function createBridge() {
  return {
    injectUserMessage: vi.fn(() => "sent" as const),
    broadcastToSession: vi.fn(),
    isSessionPaused: vi.fn(() => false),
  } as any;
}

/** A check runner whose results the test queues; an empty queue means "not yet" (exit 1). */
function createRunner() {
  const results: Array<CheckOutcome | Promise<CheckOutcome>> = [];
  const runner = {
    target: vi.fn(async (_sessionId: string, host: string | undefined) =>
      host ? { host } : { host: "devbox", cwd: "/repo" },
    ),
    run: vi.fn(async () => (await results.shift()) ?? { exitCode: 1, output: "running 3/16\n" }),
  } satisfies TimerCheckRunner;
  return { runner, results };
}

/** Let checks started by a sweep finish and record their results. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
}

describe("TimerManager timer checks", () => {
  let bridge: ReturnType<typeof createBridge>;
  let checks: ReturnType<typeof createRunner>;
  let manager: TimerManager;

  beforeEach(() => {
    // Only Date is faked: checks settle through real microtasks and setImmediate.
    vi.useFakeTimers({ now: START, toFake: ["Date"] });
    mockFiles.clear();
    bridge = createBridge();
    checks = createRunner();
    manager = new TimerManager(bridge, checks.runner);
  });

  afterEach(() => {
    manager.destroy();
    vi.useRealTimers();
  });

  /** Advance the clock one tick of `every` and run the sweep. */
  async function tick(minutes: number): Promise<void> {
    vi.setSystemTime(Date.now() + minutes * MINUTE);
    await manager.sweepDueTimersNow();
    await settle();
  }

  it("runs the check once on creation, on the session's machine and folder, and keeps its result", async () => {
    const timer = await manager.createTimer("s1", { title: "Build done", every: "5m", check: "grep -q DONE b.log" });

    expect(checks.runner.target).toHaveBeenCalledWith("s1", undefined);
    expect(checks.runner.run).toHaveBeenCalledWith(
      expect.objectContaining({ host: "devbox", cwd: "/repo", command: "grep -q DONE b.log" }),
    );
    expect(timer.id).toBe("t1");
    expect(timer.check).toMatchObject({
      host: "devbox",
      cwd: "/repo",
      wakeEvery: 10,
      checksSinceWake: 0,
      lastResult: { exitCode: 1, output: "running 3/16\n" },
    });
    expect(manager.listTimers("s1")).toHaveLength(1);
    // Creation itself never wakes the session; the CLI prints the first result.
    expect(bridge.injectUserMessage).not.toHaveBeenCalled();
  });

  it("refuses checks without --every, faster than a minute, or with a bad --wake-every", async () => {
    await expect(manager.createTimer("s1", { title: "x", in: "5m", check: "true" })).rejects.toThrow("--every");
    await expect(manager.createTimer("s1", { title: "x", every: "30s", check: "true" })).rejects.toThrow(
      "at most every minute",
    );
    await expect(manager.createTimer("s1", { title: "x", every: "5m", check: "true", wakeEvery: 0 })).rejects.toThrow(
      "--wake-every",
    );
    expect(checks.runner.run).not.toHaveBeenCalled();
  });

  it("refuses a check that cannot run, with its output, and keeps no timer", async () => {
    checks.results.push({ exitCode: 127, output: "sh: grpe: command not found\n" });
    await expect(manager.createTimer("s1", { title: "x", every: "5m", check: "grpe DONE b.log" })).rejects.toThrow(
      /could not run on devbox \(exit 127\):\nsh: grpe: command not found/,
    );

    checks.results.push({ exitCode: null, output: "", error: "Host condor is offline" });
    await expect(manager.createTimer("s1", { title: "x", every: "5m", host: "condor", check: "true" })).rejects.toThrow(
      "could not run on condor (Host condor is offline)",
    );
    expect(manager.listTimers("s1")).toEqual([]);
  });

  it("reports a check that already passes without keeping a timer or using up its id", async () => {
    checks.results.push({ exitCode: 0, output: "DONE\n" });
    const passed = await manager.createTimer("s1", { title: "x", every: "5m", check: "grep DONE b.log" });
    expect(passed.check?.lastResult?.exitCode).toBe(0);
    expect(manager.listTimers("s1")).toEqual([]);

    const next = await manager.createTimer("s1", { title: "plain", in: "5m" });
    expect(next.id).toBe("t1");
  });

  it("checks quietly at each tick and wakes with the latest result every wakeEvery checks", async () => {
    await manager.createTimer("s1", { title: "Run done", every: "5m", check: "./mon.sh", wakeEvery: 3 });

    await tick(5);
    await tick(5);
    expect(bridge.injectUserMessage).not.toHaveBeenCalled();
    expect(manager.listTimers("s1")[0]!.check!.checksSinceWake).toBe(2);
    // The progress so far is saved, so a restart keeps counting toward the next wake.
    expect(mockFiles.get("s1")!.timers[0]!.check!.checksSinceWake).toBe(2);

    checks.results.push({ exitCode: 1, output: "running 9/16\n" });
    await tick(5);
    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);
    const [sessionId, content, source] = bridge.injectUserMessage.mock.calls[0]!;
    expect(sessionId).toBe("s1");
    expect(source).toEqual({ sessionId: "timer:t1", sessionLabel: "Timer t1" });
    expect(content).toContain("[⏰ Timer t1 reminder] Run done");
    expect(content).toContain("has not passed in 3 checks");
    expect(content).toContain("Latest result: exit 1");
    expect(content).toContain("running 9/16");

    // The timer keeps checking, and the count starts over.
    const [timer] = manager.listTimers("s1");
    expect(timer!.check!.checksSinceWake).toBe(0);
    expect(timer!.fireCount).toBe(1);
  });

  it("wakes the session and ends the timer when the check passes", async () => {
    await manager.createTimer("s1", {
      title: "Wave 1 at Harbor",
      every: "5m",
      check: "grep -q passed h.log",
      description: "Launch the GPT run.",
    });

    checks.results.push({ exitCode: 0, output: "harbor: passed\n" });
    await tick(5);

    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);
    const content = bridge.injectUserMessage.mock.calls[0]![1] as string;
    expect(content).toMatch(/^\[⏰ Timer t1 reminder\] Wave 1 at Harbor\n\nYour timer's check passed/);
    expect(content).toContain("after 1 check, so the timer has ended");
    expect(content).toContain("harbor: passed");
    expect(content).toContain("Earlier note:\nLaunch the GPT run.");
    // A check wake is an ordinary timer firing to delivery, routing and quiet-turn rules.
    const [, , agentSource, , , extra] = bridge.injectUserMessage.mock.calls[0]!;
    expect(isTimerReminderFiring({ content, agentSource, timerFiring: extra.timerFiring })).toBe(true);
    expect(manager.listTimers("s1")).toEqual([]);
    expect(mockFiles.get("s1")!.timers).toEqual([]);
  });

  it("counts a check that could not run as not passed and shows why at the periodic wake", async () => {
    await manager.createTimer("s1", { title: "x", every: "5m", check: "true", wakeEvery: 1 });
    checks.results.push({ exitCode: null, output: "", error: "Host condor is offline" });
    await tick(5);

    const content = bridge.injectUserMessage.mock.calls[0]![1] as string;
    expect(content).toContain("Latest result: could not run: Host condor is offline");
    expect(manager.listTimers("s1")).toHaveLength(1);
  });

  it("never starts a check while the previous one still runs", async () => {
    await manager.createTimer("s1", { title: "x", every: "1m", check: "slow" });
    let finish!: (result: CheckOutcome) => void;
    checks.results.push(new Promise<CheckOutcome>((resolve) => (finish = resolve)));

    await tick(1);
    await tick(1);
    // Creation plus one running tick; the second tick found it still running.
    expect(checks.runner.run).toHaveBeenCalledTimes(2);

    finish({ exitCode: 0, output: "done" });
    await settle();
    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);
  });

  it("does not wake the session for a check that ends after its timer was cancelled", async () => {
    await manager.createTimer("s1", { title: "x", every: "1m", check: "slow" });
    let finish!: (result: CheckOutcome) => void;
    checks.results.push(new Promise<CheckOutcome>((resolve) => (finish = resolve)));
    await tick(1);

    await manager.cancelTimer("s1", "t1");
    bridge.injectUserMessage.mockClear();
    finish({ exitCode: 0, output: "done" });
    await settle();
    expect(bridge.injectUserMessage).not.toHaveBeenCalled();
  });
});
