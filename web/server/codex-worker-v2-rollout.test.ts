import { describe, expect, it, vi } from "vitest";
import {
  compareCodexWorkerRolloutPreservation,
  isOrdinaryCodexWorker,
  ordinaryCodexWorkerExclusionReason,
  runCodexWorkerV2Rollout,
  type CodexWorkerPreparedV2Cutover,
  type CodexWorkerRolloutPreservationSnapshot,
  type CodexWorkerV2RolloutDeps,
  type CodexWorkerV2RolloutSession,
  type CodexWorkerV2RuntimeSnapshot,
} from "./codex-worker-v2-rollout.js";

function worker(sessionId: string, overrides: Partial<CodexWorkerV2RolloutSession> = {}): CodexWorkerV2RolloutSession {
  return {
    sessionId,
    sessionNum: Number(sessionId.replace(/\D/g, "")) || 1,
    name: `Worker ${sessionId}`,
    backendType: "codex",
    state: "connected",
    herdedBy: "leader-1",
    archived: false,
    isOrchestrator: false,
    hidden: false,
    ...overrides,
  };
}

function runtime(overrides: Partial<CodexWorkerV2RuntimeSnapshot> = {}): CodexWorkerV2RuntimeSnapshot {
  return {
    backendState: "connected",
    backendAttached: true,
    backendConnected: true,
    isGenerating: false,
    hasActiveTurn: false,
    interruptedDuringTurn: false,
    paused: false,
    relaunchPending: false,
    pendingPermissionCount: 0,
    effectiveMultiAgentVersion: "v1",
    ...overrides,
  };
}

function preserved(id = "base"): CodexWorkerRolloutPreservationSnapshot {
  return {
    history: [
      { id: `history-${id}-1`, fingerprint: "h1" },
      { id: `history-${id}-2`, fingerprint: "h2" },
    ],
    pendingInputs: [{ id: `input-${id}-1`, fingerprint: "i1" }],
    pendingTurns: [{ id: `turn-${id}-1`, fingerprint: "t1" }],
    launchConfigFingerprint: `launch-${id}`,
    questFingerprint: `quest-${id}`,
    worktreeFingerprint: `worktree-${id}`,
    recoveryFingerprint: `recovery-${id}`,
    sessionIdentityFingerprint: `identity-${id}`,
  };
}

function cloneSnapshot(snapshot: CodexWorkerRolloutPreservationSnapshot): CodexWorkerRolloutPreservationSnapshot {
  return {
    ...snapshot,
    history: snapshot.history.map((item) => ({ ...item })),
    pendingInputs: snapshot.pendingInputs.map((item) => ({ ...item })),
    pendingTurns: snapshot.pendingTurns.map((item) => ({ ...item })),
  };
}

function makeDeps(
  options: {
    sessions?: CodexWorkerV2RolloutSession[];
    runtimeBySession?: Record<string, CodexWorkerV2RuntimeSnapshot | null>;
    snapshotBySession?: Record<string, CodexWorkerRolloutPreservationSnapshot>;
  } = {},
) {
  const sessions = options.sessions ?? [worker("worker-1")];
  const runtimeBySession =
    options.runtimeBySession ?? Object.fromEntries(sessions.map((item) => [item.sessionId, runtime()]));
  const snapshotBySession =
    options.snapshotBySession ??
    Object.fromEntries(sessions.map((item) => [item.sessionId, preserved(item.sessionId)]));
  const preparedBySession = new Map<string, CodexWorkerPreparedV2Cutover>();

  const deps: CodexWorkerV2RolloutDeps = {
    listSessions: vi.fn(async () => sessions),
    getRuntimeSnapshot: vi.fn(async (sessionId) => runtimeBySession[sessionId] ?? null),
    getHandoffInput: vi.fn(async () => ({
      claimedQuest: { id: "q-42", title: "Safe rollout", status: "in_progress", phase: "Work" },
      worktree: { cwd: "/repo/worktree", repoRoot: "/repo", actualBranch: "worker-branch" },
      pendingInputCount: 1,
      pendingTurnCount: 1,
      messageHistory: [
        { type: "user_message", content: "Continue the approved work." },
        {
          type: "assistant",
          message: { content: [{ type: "text", text: "Implementation context is retained." }] },
        },
      ],
    })),
    capturePreservationSnapshot: vi.fn(async (sessionId) => cloneSnapshot(snapshotBySession[sessionId])),
    freezeModelBoundDelivery: vi.fn(async () => true),
    releaseModelBoundDelivery: vi.fn(async () => {}),
    prepareFreshThreadCutover: vi.fn(async ({ session, cutoverId, activation, handoff }) => {
      expect(handoff.extraInstructions).toContain("Takode fresh-thread recovery context");
      const prepared = {
        sessionId: session.sessionId,
        cutoverId,
        activation,
        opaque: { originalThreadId: "v1-thread" },
      };
      preparedBySession.set(session.sessionId, prepared);
      return prepared;
    }),
    stageFreshThreadCutover: vi.fn(async () => {}),
    getPreparedFreshThreadCutover: vi.fn(async (session) => preparedBySession.get(session.sessionId) ?? null),
    relaunchFreshThread: vi.fn(async () => ({ ok: true })),
    waitForEffectiveVersion: vi.fn(async () => ({ version: "v2" as const })),
    commitFreshThreadCutover: vi.fn(async () => {}),
    rollbackFreshThreadCutover: vi.fn(async () => ({ ok: true, effectiveVersion: "v1" as const })),
    now: () => 1_786_679_000_000,
  };

  return { deps, sessions, runtimeBySession, snapshotBySession, preparedBySession };
}

describe("ordinary Codex worker classification", () => {
  it("requires a visible, herded, non-reviewer Codex worker", () => {
    expect(isOrdinaryCodexWorker(worker("worker-1"))).toBe(true);
    expect(ordinaryCodexWorkerExclusionReason(worker("claude", { backendType: "claude" }))).toBe("not_codex");
    expect(ordinaryCodexWorkerExclusionReason(worker("archived", { archived: true }))).toBe("archived");
    expect(ordinaryCodexWorkerExclusionReason(worker("leader", { isOrchestrator: true }))).toBe("leader");
    expect(ordinaryCodexWorkerExclusionReason(worker("reviewer", { reviewerOf: 22 }))).toBe("reviewer");
    expect(ordinaryCodexWorkerExclusionReason(worker("hidden", { hidden: true }))).toBe("hidden");
    expect(ordinaryCodexWorkerExclusionReason(worker("private", { publicSessionNumber: false }))).toBe("hidden");
    expect(ordinaryCodexWorkerExclusionReason(worker("manual", { herdedBy: null }))).toBe("not_worker");
  });

  it("reports excluded roles without invoking runtime or cutover hooks", async () => {
    const sessions = [
      worker("claude", { backendType: "claude" }),
      worker("archived", { archived: true }),
      worker("leader", { isOrchestrator: true }),
      worker("reviewer", { reviewerOf: 9 }),
      worker("hidden", { hidden: true }),
      worker("manual", { herdedBy: undefined }),
    ];
    const { deps } = makeDeps({ sessions });

    const result = await runCodexWorkerV2Rollout(deps);

    expect(result.results.map((item) => item.reason)).toEqual([
      "not_codex",
      "archived",
      "leader",
      "reviewer",
      "hidden",
      "not_worker",
    ]);
    expect(deps.getRuntimeSnapshot).not.toHaveBeenCalled();
    expect(deps.prepareFreshThreadCutover).not.toHaveBeenCalled();
  });
});

describe("rollout readiness and staging", () => {
  it.each([
    ["interrupted turn", runtime({ interruptedDuringTurn: true }), "interrupted_turn"],
    ["active generation", runtime({ isGenerating: true }), "active_turn"],
    ["active backend turn", runtime({ hasActiveTurn: true }), "active_turn"],
    ["paused worker", runtime({ paused: true }), "paused"],
    ["pending permission", runtime({ pendingPermissionCount: 1 }), "pending_permission"],
    ["initializing backend", runtime({ backendState: "initializing" }), "initializing"],
    ["relaunch in progress", runtime({ relaunchPending: true }), "initializing"],
    [
      "broken backend",
      runtime({ backendState: "broken", backendAttached: false, backendConnected: false }),
      "backend_unhealthy",
    ],
  ])("defers %s without preparing a cutover", async (_label, runtimeSnapshot, expectedReason) => {
    const session = worker("worker-1");
    const { deps } = makeDeps({ sessions: [session], runtimeBySession: { [session.sessionId]: runtimeSnapshot } });

    const result = await runCodexWorkerV2Rollout(deps);

    expect(result.results[0]).toMatchObject({ action: "deferred", reason: expectedReason });
    expect(deps.prepareFreshThreadCutover).not.toHaveBeenCalled();
    expect(deps.relaunchFreshThread).not.toHaveBeenCalled();
  });

  it("stages a disconnected worker for its next legitimate resume without starting it", async () => {
    const session = worker("worker-1", { state: "exited" });
    const { deps } = makeDeps({
      sessions: [session],
      runtimeBySession: {
        [session.sessionId]: runtime({
          backendState: "disconnected",
          backendAttached: false,
          backendConnected: false,
        }),
      },
    });

    const result = await runCodexWorkerV2Rollout(deps);

    expect(result.results[0]).toMatchObject({ action: "staged", reason: "prepared_for_next_resume" });
    expect(deps.prepareFreshThreadCutover).toHaveBeenCalledWith(expect.objectContaining({ activation: "next_resume" }));
    expect(deps.stageFreshThreadCutover).toHaveBeenCalledTimes(1);
    expect(deps.relaunchFreshThread).not.toHaveBeenCalled();
  });

  it("keeps an explicit selected V1 worker on the sticky rollback/default-off path", async () => {
    // Explicit V1 is distinct from legacy undefined: it records a rollback or
    // compatibility choice that later startup reconciliation must not undo.
    const session = worker("worker-1", { selectedMultiAgentVersion: "v1" });
    const { deps } = makeDeps({
      sessions: [session],
      runtimeBySession: { [session.sessionId]: runtime({ effectiveMultiAgentVersion: null }) },
    });

    const result = await runCodexWorkerV2Rollout(deps);

    expect(result.results[0]).toMatchObject({ action: "unchanged", reason: "explicit_v1" });
    expect(deps.prepareFreshThreadCutover).not.toHaveBeenCalled();
  });

  it("does not fresh-cut over a newly selected V2 worker before its first normal turn", async () => {
    const session = worker("worker-1", { selectedMultiAgentVersion: "v2" });
    const { deps } = makeDeps({
      sessions: [session],
      runtimeBySession: { [session.sessionId]: runtime({ effectiveMultiAgentVersion: null }) },
    });

    const result = await runCodexWorkerV2Rollout(deps);

    expect(result.results[0]).toMatchObject({
      action: "awaiting_effective",
      reason: "selected_v2_awaiting_first_turn",
      effectiveVersion: null,
    });
    expect(deps.prepareFreshThreadCutover).not.toHaveBeenCalled();
    expect(deps.relaunchFreshThread).not.toHaveBeenCalled();
  });

  it("repairs selected V2 only after retained diagnostics explicitly report V1", async () => {
    const session = worker("worker-1", { selectedMultiAgentVersion: "v2" });
    const { deps } = makeDeps({
      sessions: [session],
      runtimeBySession: { [session.sessionId]: runtime({ effectiveMultiAgentVersion: "v1" }) },
    });

    const result = await runCodexWorkerV2Rollout(deps);

    expect(result.results[0]).toMatchObject({ action: "migrated", reason: "cutover_complete" });
    expect(deps.prepareFreshThreadCutover).toHaveBeenCalledTimes(1);
  });

  it("skips a worker whose retained effective diagnostics already prove V2", async () => {
    const session = worker("worker-1");
    const { deps } = makeDeps({
      sessions: [session],
      runtimeBySession: { [session.sessionId]: runtime({ effectiveMultiAgentVersion: "v2" }) },
    });

    const result = await runCodexWorkerV2Rollout(deps);

    expect(result.results[0]).toMatchObject({ action: "unchanged", reason: "effective_v2", effectiveVersion: "v2" });
    expect(deps.prepareFreshThreadCutover).not.toHaveBeenCalled();
  });
});

describe("connected idle cutover", () => {
  it("prepares, verifies, relaunches, proves V2, and only then clears the one-shot handoff", async () => {
    const { deps } = makeDeps();
    const order: string[] = [];
    vi.mocked(deps.prepareFreshThreadCutover).mockImplementation(async (args) => {
      order.push("prepare");
      return { sessionId: args.session.sessionId, cutoverId: args.cutoverId, activation: args.activation, opaque: {} };
    });
    vi.mocked(deps.relaunchFreshThread).mockImplementation(async () => {
      order.push("relaunch");
      return { ok: true };
    });
    vi.mocked(deps.waitForEffectiveVersion).mockImplementation(async () => {
      order.push("session_meta");
      return { version: "v2" };
    });
    vi.mocked(deps.commitFreshThreadCutover).mockImplementation(async (_prepared, verification) => {
      order.push(`commit:${verification}`);
    });

    const result = await runCodexWorkerV2Rollout(deps);

    expect(result.results[0]).toMatchObject({ action: "migrated", reason: "cutover_complete", effectiveVersion: "v2" });
    expect(order).toEqual(["prepare", "relaunch", "session_meta", "commit:confirmed_v2"]);
    expect(deps.capturePreservationSnapshot).toHaveBeenCalledTimes(2);
    expect(deps.rollbackFreshThreadCutover).not.toHaveBeenCalled();
  });

  it("defers before preparation when the atomic delivery freeze observes an in-flight turn", async () => {
    const { deps } = makeDeps();
    vi.mocked(deps.freezeModelBoundDelivery).mockResolvedValue(false);

    const result = await runCodexWorkerV2Rollout(deps);

    expect(result.results[0]).toMatchObject({ action: "deferred", reason: "became_active" });
    expect(deps.prepareFreshThreadCutover).not.toHaveBeenCalled();
    expect(deps.relaunchFreshThread).not.toHaveBeenCalled();
  });

  it("keeps rollback provenance when session_meta has no effective version before the first real turn", async () => {
    // A fresh idle thread has no turn_context. Unknown is therefore not a V2
    // failure and must not trigger a synthetic proof turn or premature rollback.
    const { deps } = makeDeps();
    vi.mocked(deps.waitForEffectiveVersion).mockResolvedValue({ version: null, detail: "no turn_context yet" });

    const result = await runCodexWorkerV2Rollout(deps);

    expect(result.results[0]).toMatchObject({
      action: "awaiting_effective",
      reason: "awaiting_first_turn",
      effectiveVersion: null,
    });
    expect(deps.commitFreshThreadCutover).toHaveBeenCalledWith(expect.anything(), "awaiting_first_turn");
    expect(deps.rollbackFreshThreadCutover).not.toHaveBeenCalled();
  });

  it("finalizes an awaiting cutover after the first retained turn proves V2", async () => {
    const session = worker("worker-1", { workerV2CutoverState: "awaiting_effective" });
    const { deps, preparedBySession } = makeDeps({
      sessions: [session],
      runtimeBySession: { [session.sessionId]: runtime({ effectiveMultiAgentVersion: "v2" }) },
    });
    preparedBySession.set(session.sessionId, {
      sessionId: session.sessionId,
      cutoverId: "existing-cutover",
      activation: "now",
      opaque: { originalThreadId: "v1-thread" },
    });

    const result = await runCodexWorkerV2Rollout(deps);

    expect(result.results[0]).toMatchObject({
      action: "migrated",
      reason: "cutover_complete",
      cutoverId: "existing-cutover",
    });
    expect(deps.commitFreshThreadCutover).toHaveBeenCalledWith(expect.anything(), "confirmed_v2");
    expect(deps.prepareFreshThreadCutover).not.toHaveBeenCalled();
  });

  it("does not manufacture a turn while an awaiting cutover still lacks effective evidence", async () => {
    const session = worker("worker-1", { workerV2CutoverState: "awaiting_effective" });
    const { deps, preparedBySession } = makeDeps({
      sessions: [session],
      runtimeBySession: { [session.sessionId]: runtime({ effectiveMultiAgentVersion: null }) },
    });
    preparedBySession.set(session.sessionId, {
      sessionId: session.sessionId,
      cutoverId: "existing-cutover",
      activation: "now",
      opaque: {},
    });

    const result = await runCodexWorkerV2Rollout(deps);

    expect(result.results[0]).toMatchObject({ action: "awaiting_effective", reason: "awaiting_first_turn" });
    expect(deps.relaunchFreshThread).not.toHaveBeenCalled();
    expect(deps.commitFreshThreadCutover).not.toHaveBeenCalled();
    expect(deps.rollbackFreshThreadCutover).not.toHaveBeenCalled();
  });

  it("defers awaiting-effective reconciliation while the replacement worker is active", async () => {
    const session = worker("worker-1", { workerV2CutoverState: "awaiting_effective" });
    const { deps, preparedBySession } = makeDeps({
      sessions: [session],
      runtimeBySession: {
        [session.sessionId]: runtime({ isGenerating: true, effectiveMultiAgentVersion: "v1" }),
      },
    });
    preparedBySession.set(session.sessionId, {
      sessionId: session.sessionId,
      cutoverId: "existing-cutover",
      activation: "now",
      opaque: {},
    });

    const result = await runCodexWorkerV2Rollout(deps);

    expect(result.results[0]).toMatchObject({ action: "deferred", reason: "active_turn" });
    expect(deps.rollbackFreshThreadCutover).not.toHaveBeenCalled();
  });

  it("rolls back an awaiting cutover when the first retained turn explicitly reports V1", async () => {
    const session = worker("worker-1", { workerV2CutoverState: "awaiting_effective" });
    const { deps, preparedBySession } = makeDeps({ sessions: [session] });
    preparedBySession.set(session.sessionId, {
      sessionId: session.sessionId,
      cutoverId: "existing-cutover",
      activation: "now",
      opaque: {},
    });

    const result = await runCodexWorkerV2Rollout(deps);

    expect(result.results[0]).toMatchObject({
      action: "rolled_back",
      reason: "effective_version_mismatch",
      effectiveVersion: "v1",
    });
    expect(deps.rollbackFreshThreadCutover).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "effective_version_mismatch", targetVersion: "v1", requireRelaunch: true }),
    );
    expect(result.halted).toBe(true);
  });
});

describe("preservation and rollback safety", () => {
  it("allows monotonic history/queue additions but detects removed or modified baseline state", () => {
    const baseline = preserved("one");
    const monotonic = cloneSnapshot(baseline);
    monotonic.history = [...monotonic.history, { id: "new-history", fingerprint: "new" }];
    monotonic.pendingInputs = [
      { id: "new-before", fingerprint: "new" },
      ...monotonic.pendingInputs,
      { id: "new-after", fingerprint: "new" },
    ];
    expect(compareCodexWorkerRolloutPreservation(baseline, monotonic)).toEqual([]);

    const changed = cloneSnapshot(baseline);
    changed.history = [{ ...changed.history[0], fingerprint: "mutated" }, ...changed.history.slice(1)];
    changed.pendingTurns = [];
    changed.worktreeFingerprint = "moved-worktree";
    changed.recoveryFingerprint = "changed-recovery";
    changed.sessionIdentityFingerprint = "changed-identity";
    expect(compareCodexWorkerRolloutPreservation(baseline, changed)).toEqual([
      "history_changed_or_removed",
      "pending_turns_changed_or_removed",
      "worktree_identity_changed",
      "recovery_state_changed",
      "session_identity_changed",
    ]);
  });

  it("rolls back to V1 and halts the batch when fresh-thread relaunch fails", async () => {
    const sessions = [worker("worker-1"), worker("worker-2")];
    const { deps } = makeDeps({ sessions });
    vi.mocked(deps.relaunchFreshThread).mockResolvedValueOnce({ ok: false, error: "spawn failed" });

    const result = await runCodexWorkerV2Rollout(deps, { maxSessions: 2 });

    expect(result.results[0]).toMatchObject({
      action: "rolled_back",
      reason: "relaunch_failed",
      detail: "spawn failed",
    });
    expect(result.results[1]).toMatchObject({ action: "deferred", reason: "rollout_halted" });
    expect(deps.rollbackFreshThreadCutover).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "relaunch_failed", targetVersion: "v1", requireRelaunch: true }),
    );
    expect(deps.prepareFreshThreadCutover).toHaveBeenCalledTimes(1);
    expect(result.halted).toBe(true);
  });

  it("leaves an in-flight durable cutover pending when shutdown aborts verification", async () => {
    const { deps } = makeDeps();
    vi.mocked(deps.waitForEffectiveVersion).mockResolvedValue({
      version: null,
      aborted: true,
      detail: "server shutdown left the durable cutover pending for restart recovery",
    });

    const result = await runCodexWorkerV2Rollout(deps);

    expect(result.results[0]).toMatchObject({ action: "deferred", reason: "initializing" });
    expect(deps.rollbackFreshThreadCutover).not.toHaveBeenCalled();
    expect(deps.releaseModelBoundDelivery).not.toHaveBeenCalled();
    expect(deps.commitFreshThreadCutover).not.toHaveBeenCalled();
    expect(result.halted).toBe(false);
  });

  it("rolls back only an explicit post-session_meta effective mismatch", async () => {
    const { deps } = makeDeps();
    vi.mocked(deps.waitForEffectiveVersion).mockResolvedValue({ version: "disabled", detail: "tools disabled" });

    const result = await runCodexWorkerV2Rollout(deps);

    expect(result.results[0]).toMatchObject({
      action: "rolled_back",
      reason: "effective_version_mismatch",
      effectiveVersion: "v1",
    });
    expect(deps.commitFreshThreadCutover).not.toHaveBeenCalled();
    expect(result.halted).toBe(true);
  });

  it("rolls back before relaunch when preparation changes preserved history or queues", async () => {
    const session = worker("worker-1");
    const baseline = preserved(session.sessionId);
    let captures = 0;
    const { deps } = makeDeps({ sessions: [session], snapshotBySession: { [session.sessionId]: baseline } });
    vi.mocked(deps.capturePreservationSnapshot).mockImplementation(async () => {
      captures += 1;
      const snapshot = cloneSnapshot(baseline);
      if (captures > 1) snapshot.pendingInputs = [];
      return snapshot;
    });

    const result = await runCodexWorkerV2Rollout(deps);

    expect(result.results[0]).toMatchObject({
      action: "rolled_back",
      reason: "preservation_mismatch",
      preservationDifferences: ["pending_inputs_changed_or_removed"],
    });
    expect(deps.relaunchFreshThread).not.toHaveBeenCalled();
    expect(deps.rollbackFreshThreadCutover).toHaveBeenCalledWith(
      expect.objectContaining({ requireRelaunch: false, reason: "preservation_mismatch" }),
    );
  });

  it("treats an unproven V1 relaunch as rollback failure", async () => {
    const { deps } = makeDeps();
    vi.mocked(deps.relaunchFreshThread).mockResolvedValueOnce({ ok: false, error: "V2 failed" });
    vi.mocked(deps.rollbackFreshThreadCutover).mockResolvedValueOnce({ ok: true });

    const result = await runCodexWorkerV2Rollout(deps);

    expect(result.results[0]).toMatchObject({ action: "rollback_failed", reason: "relaunch_failed" });
    expect(result.halted).toBe(true);
  });

  it("halts safely while a fresh V1 rollback awaits its first retained turn", async () => {
    const { deps } = makeDeps();
    vi.mocked(deps.relaunchFreshThread).mockResolvedValueOnce({ ok: false, error: "V2 failed" });
    vi.mocked(deps.rollbackFreshThreadCutover).mockResolvedValueOnce({
      ok: true,
      effectiveVersion: null,
      awaitingFirstTurn: true,
    });

    const result = await runCodexWorkerV2Rollout(deps);

    expect(result.results[0]).toMatchObject({
      action: "awaiting_effective",
      reason: "awaiting_first_turn",
      effectiveVersion: null,
    });
    expect(result.halted).toBe(true);
  });

  it("reports rollback failure and stops before touching later workers", async () => {
    const sessions = [worker("worker-1"), worker("worker-2")];
    const { deps } = makeDeps({ sessions });
    vi.mocked(deps.relaunchFreshThread).mockResolvedValueOnce({ ok: false, error: "V2 failed" });
    vi.mocked(deps.rollbackFreshThreadCutover).mockResolvedValueOnce({
      ok: false,
      effectiveVersion: "v2",
      error: "V1 resume failed",
    });

    const result = await runCodexWorkerV2Rollout(deps, { maxSessions: 2 });

    expect(result.results[0]).toMatchObject({ action: "rollback_failed", detail: "V1 resume failed" });
    expect(result.results[1]).toMatchObject({ action: "deferred", reason: "rollout_halted" });
    expect(result.halted).toBe(true);
  });

  it.each([
    ["rolling_back", "deferred", "rollout_halted"],
    ["awaiting_rollback_effective", "awaiting_effective", "awaiting_first_turn"],
    ["rolled_back", "rolled_back", "rollout_halted"],
    ["rollback_failed", "rollback_failed", "rollout_halted"],
  ] as const)("halts before later workers when durable cutover state is %s", async (state, action, reason) => {
    const sessions = [worker("worker-1", { workerV2CutoverState: state }), worker("worker-2")];
    const { deps } = makeDeps({ sessions });

    const result = await runCodexWorkerV2Rollout(deps, { maxSessions: 2 });

    expect(result.results[0]).toMatchObject({ action, reason });
    expect(result.results[1]).toMatchObject({ action: "deferred", reason: "rollout_halted" });
    expect(deps.prepareFreshThreadCutover).not.toHaveBeenCalled();
    expect(result.halted).toBe(true);
  });

  it("rechecks liveness after preparation and defers if the worker becomes active", async () => {
    // The preflight/prepare gap is a real race: rollback the inert preparation
    // rather than interrupting a turn that started after the first snapshot.
    const session = worker("worker-1");
    const { deps } = makeDeps({ sessions: [session] });
    vi.mocked(deps.getRuntimeSnapshot)
      .mockResolvedValueOnce(runtime())
      .mockResolvedValueOnce(runtime({ isGenerating: true }));

    const result = await runCodexWorkerV2Rollout(deps);

    expect(result.results[0]).toMatchObject({ action: "deferred", reason: "became_active" });
    expect(deps.freezeModelBoundDelivery).toHaveBeenCalledTimes(1);
    expect(deps.releaseModelBoundDelivery).toHaveBeenCalledTimes(1);
    expect(deps.rollbackFreshThreadCutover).not.toHaveBeenCalled();
    expect(deps.relaunchFreshThread).not.toHaveBeenCalled();
    expect(result.halted).toBe(false);
  });
});

describe("bounded sequential processing", () => {
  it("processes eligible workers sequentially and defers the remainder at the batch limit", async () => {
    const sessions = [worker("worker-1"), worker("worker-2"), worker("worker-3")];
    const { deps } = makeDeps({ sessions });
    const order: string[] = [];
    vi.mocked(deps.prepareFreshThreadCutover).mockImplementation(async ({ session, cutoverId, activation }) => {
      order.push(`prepare:${session.sessionId}`);
      return { sessionId: session.sessionId, cutoverId, activation, opaque: {} };
    });
    vi.mocked(deps.commitFreshThreadCutover).mockImplementation(async (prepared) => {
      order.push(`commit:${prepared.sessionId}`);
    });

    const result = await runCodexWorkerV2Rollout(deps, { maxSessions: 2 });

    expect(order).toEqual(["prepare:worker-1", "commit:worker-1", "prepare:worker-2", "commit:worker-2"]);
    expect(result.results[2]).toMatchObject({ action: "deferred", reason: "batch_limit" });
    expect(result.processedEligibleSessions).toBe(2);
    expect(result.remainingEligibleSessions).toBe(1);
  });
});
