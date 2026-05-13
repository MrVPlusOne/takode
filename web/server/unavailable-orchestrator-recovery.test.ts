import { describe, expect, it, vi } from "vitest";
import {
  createUnavailableOrchestratorRecoveryWake,
  shouldWakeUnavailableOrchestratorForPendingEvents,
} from "./unavailable-orchestrator-recovery.js";

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "leader-1",
    backendType: "codex",
    state: { backend_state: "disconnected" },
    isGenerating: false,
    ...overrides,
  };
}

function makeDeps(info: Record<string, unknown> | undefined = { isOrchestrator: true, state: "exited" }) {
  return {
    getLauncherSessionInfo: vi.fn(() => info),
  };
}

describe("shouldWakeUnavailableOrchestratorForPendingEvents", () => {
  it("allows unavailable orchestrator sessions with no attached backend", () => {
    expect(shouldWakeUnavailableOrchestratorForPendingEvents(makeSession(), makeDeps())).toBe(true);
  });

  it("does not wake ordinary workers", () => {
    expect(
      shouldWakeUnavailableOrchestratorForPendingEvents(
        makeSession(),
        makeDeps({ isOrchestrator: false, state: "exited" }),
      ),
    ).toBe(false);
  });

  it("does not wake archived or idle-manager-killed leaders", () => {
    expect(
      shouldWakeUnavailableOrchestratorForPendingEvents(
        makeSession(),
        makeDeps({ isOrchestrator: true, state: "exited", archived: true }),
      ),
    ).toBe(false);
    expect(
      shouldWakeUnavailableOrchestratorForPendingEvents(
        makeSession(),
        makeDeps({ isOrchestrator: true, state: "exited", killedByIdleManager: true }),
      ),
    ).toBe(false);
  });

  it("does not wake healthy attached or actively generating leaders", () => {
    expect(shouldWakeUnavailableOrchestratorForPendingEvents(makeSession({ codexAdapter: {} }), makeDeps())).toBe(
      false,
    );
    expect(shouldWakeUnavailableOrchestratorForPendingEvents(makeSession({ isGenerating: true }), makeDeps())).toBe(
      false,
    );
  });

  it("does not wake broken sessions", () => {
    expect(
      shouldWakeUnavailableOrchestratorForPendingEvents(
        makeSession({ state: { backend_state: "broken" } }),
        makeDeps(),
      ),
    ).toBe(false);
  });

  it("does not wake paused leaders", () => {
    expect(
      shouldWakeUnavailableOrchestratorForPendingEvents(makeSession(), {
        ...makeDeps(),
        isSessionPaused: () => true,
      }),
    ).toBe(false);
  });

  it("allows pending herd events to wake Codex leaders after adapter retry-limit exhaustion", () => {
    // Adapter-disconnect retry exhaustion pauses that relaunch loop, but it is
    // not a terminal broken state. Pending herd events may still wake the leader
    // through the explicit orchestrator recovery path.
    expect(
      shouldWakeUnavailableOrchestratorForPendingEvents(
        makeSession({ consecutiveAdapterFailures: 4, lastAdapterFailureAt: Date.now() }),
        makeDeps({ isOrchestrator: true, state: "exited" }),
      ),
    ).toBe(true);
  });
});

describe("createUnavailableOrchestratorRecoveryWake", () => {
  it("dedupes recovery requests until the guard timeout clears", () => {
    vi.useFakeTimers();
    const requestCodexAutoRecovery = vi.fn(() => true);
    const wake = createUnavailableOrchestratorRecoveryWake({
      getSession: () => makeSession(),
      getLauncherSessionInfo: () => ({ isOrchestrator: true, state: "exited" }),
      requestCodexAutoRecovery,
      recoveryDedupeMs: 1000,
    });

    expect(wake("leader-1", "pending_herd_event_dead_backend")).toBe(true);
    expect(wake("leader-1", "pending_herd_event_dead_backend")).toBe(false);
    expect(requestCodexAutoRecovery).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1000);

    expect(wake("leader-1", "pending_herd_event_dead_backend")).toBe(true);
    expect(requestCodexAutoRecovery).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("uses the existing relaunch callback for non-Codex leaders", () => {
    const requestCliRelaunch = vi.fn();
    const wake = createUnavailableOrchestratorRecoveryWake({
      getSession: () => makeSession({ backendType: "claude-sdk" }),
      getLauncherSessionInfo: () => ({ isOrchestrator: true, state: "exited" }),
      requestCodexAutoRecovery: vi.fn(() => false),
      requestCliRelaunch,
    });

    expect(wake("leader-1", "pending_herd_event_dead_backend")).toBe(true);
    expect(requestCliRelaunch).toHaveBeenCalledWith("leader-1");
  });

  it("requests Codex recovery for pending herd events after adapter retry-limit exhaustion", () => {
    const exhaustedSession = makeSession({ consecutiveAdapterFailures: 4 });
    const requestCodexAutoRecovery = vi.fn(() => true);
    const wake = createUnavailableOrchestratorRecoveryWake({
      getSession: () => exhaustedSession,
      getLauncherSessionInfo: () => ({ isOrchestrator: true, state: "exited" }),
      requestCodexAutoRecovery,
    });

    expect(wake("leader-1", "pending_herd_event_dead_backend")).toBe(true);
    expect(requestCodexAutoRecovery).toHaveBeenCalledWith(exhaustedSession, "pending_herd_event_dead_backend");
  });
});
