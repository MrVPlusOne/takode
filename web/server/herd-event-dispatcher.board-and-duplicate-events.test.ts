/**
 * Tests for the push-based herd event dispatcher: board stall/dispatchable delivery and
 * the suppression of stale or duplicate events.
 *
 * Uses mock interfaces for WsBridge and Launcher from the shared test helpers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HerdEventDispatcher } from "./herd-event-dispatcher.js";
import { createMocks, makeEvent, triggerEvent } from "./herd-event-dispatcher.test-helpers.js";

describe("HerdEventDispatcher board and duplicate events", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("delivers board_stalled events with a leader-actionable summary", () => {
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);

    triggerEvent(
      makeEvent({
        event: "board_stalled",
        data: {
          questId: "q-42",
          title: "Fix auth drift",
          stage: "IMPLEMENTING",
          workerStatus: "disconnected",
          reviewerStatus: "missing",
          stalledForMs: 240_000,
          reason: "worker disconnected",
          action: "inspect worker; resume or re-dispatch before review",
        },
      }),
    );

    vi.advanceTimersByTime(600);
    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);
    const content = vi.mocked(bridge.injectUserMessage).mock.calls[0][1];
    expect(content).toContain("board_stalled");
    expect(content).toContain("q-42");
    expect(content).toContain("worker disconnected");
    expect(content).toContain("next: inspect worker");

    dispatcher.destroy();
  });

  it("drops queued board_stalled events once the leader board no longer has that row", () => {
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    vi.mocked(bridge.isSessionIdle).mockReturnValue(false);
    triggerEvent(
      makeEvent({
        event: "board_stalled",
        data: {
          questId: "q-42",
          title: "Fix auth drift",
          stage: "IMPLEMENTING",
          workerStatus: "disconnected",
          reviewerStatus: "missing",
          stalledForMs: 240_000,
          reason: "worker disconnected",
          action: "inspect worker; resume or re-dispatch before review",
        },
      }),
    );

    vi.mocked(bridge.getBoardRow!).mockReturnValue(null);
    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);
    dispatcher.onOrchestratorTurnEnd("orch-1");

    expect(bridge.injectUserMessage).not.toHaveBeenCalled();

    dispatcher.destroy();
  });

  it("drops queued board_stalled events when the row recovered in place", () => {
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    vi.mocked(bridge.isSessionIdle).mockReturnValue(false);
    triggerEvent(
      makeEvent({
        event: "board_stalled",
        data: {
          questId: "q-42",
          title: "Fix auth drift",
          stage: "IMPLEMENTING",
          signature: "sig-1",
          workerStatus: "disconnected",
          reviewerStatus: "missing",
          stalledForMs: 240_000,
          reason: "worker disconnected",
          action: "inspect worker; resume or re-dispatch before review",
        },
      }),
    );

    vi.mocked(bridge.getBoardRow!).mockReturnValue({ status: "IMPLEMENTING" });
    vi.mocked(bridge.getBoardStallSignature!).mockReturnValue(null);
    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);
    dispatcher.onOrchestratorTurnEnd("orch-1");

    expect(bridge.injectUserMessage).not.toHaveBeenCalled();

    dispatcher.destroy();
  });

  it("delivers board_dispatchable events with a leader-actionable summary", () => {
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);

    triggerEvent(
      makeEvent({
        event: "board_dispatchable",
        data: {
          questId: "q-77",
          title: "Dispatch the queued follow-up",
          summary: "q-77 can be dispatched now: wait-for resolved (q-76).",
          action: "Dispatch it now or replace QUEUED with the next active board stage.",
        },
      }),
    );

    vi.advanceTimersByTime(600);
    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);
    const content = vi.mocked(bridge.injectUserMessage).mock.calls[0][1];
    expect(content).toContain("board_dispatchable");
    expect(content).toContain("q-77");
    expect(content).toContain("can be dispatched now");
    expect(content).toContain("next: Dispatch it now");

    dispatcher.destroy();
  });

  it("drops queued board_dispatchable events when the row is no longer dispatchable", () => {
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    vi.mocked(bridge.isSessionIdle).mockReturnValue(false);
    triggerEvent(
      makeEvent({
        event: "board_dispatchable",
        data: {
          questId: "q-77",
          title: "Dispatch the queued follow-up",
          signature: "dispatchable-sig-1",
          summary: "q-77 can be dispatched now: wait-for resolved (q-76).",
        },
      }),
    );

    vi.mocked(bridge.getBoardRow!).mockReturnValue({ status: "QUEUED" });
    vi.mocked(bridge.getBoardDispatchableSignature!).mockReturnValue(null);
    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);
    dispatcher.onOrchestratorTurnEnd("orch-1");

    expect(bridge.injectUserMessage).not.toHaveBeenCalled();

    dispatcher.destroy();
  });

  it("drops queued board_dispatchable events when the row revision has advanced", () => {
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    vi.mocked(bridge.isSessionIdle).mockReturnValue(false);
    triggerEvent(
      makeEvent({
        event: "board_dispatchable",
        data: {
          questId: "q-77",
          title: "Dispatch the queued follow-up",
          signature: "dispatchable-sig-1",
          rowUpdatedAt: 100,
          summary: "q-77 can be dispatched now: wait-for resolved (q-76).",
        },
      }),
    );

    vi.mocked(bridge.getBoardRow!).mockReturnValue({ status: "QUEUED", updatedAt: 200 });
    vi.mocked(bridge.getBoardDispatchableSignature!).mockReturnValue("dispatchable-sig-1");
    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);
    dispatcher.onOrchestratorTurnEnd("orch-1");

    expect(bridge.injectUserMessage).not.toHaveBeenCalled();

    dispatcher.destroy();
  });

  it("suppresses duplicate board_dispatchable events for the same transition before delivery", () => {
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    vi.mocked(bridge.isSessionIdle).mockReturnValue(false);
    const data = {
      questId: "q-77",
      title: "Dispatch the queued follow-up",
      signature: "dispatchable-sig-1",
      rowUpdatedAt: 100,
      summary: "q-77 can be dispatched now: wait-for resolved (q-76).",
      action: "Dispatch it now.",
    };
    triggerEvent(makeEvent({ id: 1, event: "board_dispatchable", data }));
    triggerEvent(makeEvent({ id: 2, event: "board_dispatchable", data }));

    vi.mocked(bridge.getBoardRow!).mockReturnValue({ status: "QUEUED", updatedAt: 100 });
    vi.mocked(bridge.getBoardDispatchableSignature!).mockReturnValue("dispatchable-sig-1");
    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);
    dispatcher.onOrchestratorTurnEnd("orch-1");

    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(bridge.injectUserMessage).mock.calls[0][1]).toContain("1 event from 1 session");

    dispatcher.destroy();
  });

  it("suppresses duplicate turn_end events with the same message range", () => {
    // A replayed worker completion with the same message range is stale even if
    // its event id or relative-age rendering changes.
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);

    triggerEvent(
      makeEvent({
        id: 1,
        event: "turn_end",
        ts: 1000,
        data: { duration_ms: 5000, msgRange: { from: 1957, to: 1967 } },
      }),
    );
    vi.advanceTimersByTime(600);
    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);

    dispatcher.onOrchestratorTurnEnd("orch-1");
    triggerEvent(
      makeEvent({
        id: 2,
        event: "turn_end",
        ts: 2000,
        data: { duration_ms: 5000, msgRange: { from: 1957, to: 1967 } },
      }),
    );
    vi.advanceTimersByTime(600);
    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);

    triggerEvent(
      makeEvent({
        id: 3,
        event: "turn_end",
        ts: 3000,
        data: { duration_ms: 5000, msgRange: { from: 1970, to: 1971 } },
      }),
    );
    vi.advanceTimersByTime(600);
    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(2);

    dispatcher.destroy();
  });

  it("delivers same-range turn_end events when material payload fields change", () => {
    // Same message range alone is not enough to prove staleness: corrected
    // outcome, tools, quest change, user-message, or preview payloads matter.
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);

    triggerEvent(
      makeEvent({
        id: 1,
        event: "turn_end",
        data: {
          duration_ms: 5000,
          msgRange: { from: 1957, to: 1967 },
          tools: { Edit: 1 },
          resultPreview: "alive for q-968",
          userMsgs: { count: 1, ids: [1957] },
          questChange: { questId: "q-968", from: "IMPLEMENTING", to: "PORTING" },
        },
      }),
    );
    vi.advanceTimersByTime(600);
    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);

    dispatcher.onOrchestratorTurnEnd("orch-1");
    triggerEvent(
      makeEvent({
        id: 2,
        event: "turn_end",
        data: {
          duration_ms: 5000,
          is_error: true,
          compacted: true,
          msgRange: { from: 1957, to: 1967 },
          tools: { Edit: 1, Bash: 1 },
          resultPreview: "failed while validating q-968",
          userMsgs: { count: 2, ids: [1957, 1958] },
          questChange: { questId: "q-968", from: "PORTING", to: "IMPLEMENTING" },
        },
      }),
    );
    vi.advanceTimersByTime(600);
    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(2);

    dispatcher.destroy();
  });

  it("suppresses duplicate worker_stream events with the same message range", () => {
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);

    triggerEvent(
      makeEvent({
        id: 1,
        event: "worker_stream",
        ts: 1000,
        data: {
          reason: "checkpoint",
          duration_ms: 5000,
          msgRange: { from: 1957, to: 1967 },
        },
      }),
    );
    vi.advanceTimersByTime(600);
    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);

    dispatcher.onOrchestratorTurnEnd("orch-1");
    triggerEvent(
      makeEvent({
        id: 2,
        event: "worker_stream",
        ts: 2000,
        data: {
          reason: "checkpoint",
          duration_ms: 5000,
          msgRange: { from: 1957, to: 1967 },
        },
      }),
    );
    vi.advanceTimersByTime(600);
    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);

    triggerEvent(
      makeEvent({
        id: 3,
        event: "worker_stream",
        ts: 3000,
        data: {
          reason: "checkpoint",
          duration_ms: 5000,
          msgRange: { from: 1970, to: 1971 },
        },
      }),
    );
    vi.advanceTimersByTime(600);
    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(2);

    dispatcher.destroy();
  });

  it("suppresses duplicate board_stalled events when only age fields change", () => {
    // A still-stalled row should not keep notifying just because stalledForMs
    // or the rendered relative age changed. A changed reason remains deliverable.
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);
    vi.mocked(bridge.getBoardRow!).mockReturnValue({ status: "EXPLORING" });

    triggerEvent(
      makeEvent({
        id: 1,
        event: "board_stalled",
        ts: 1000,
        data: {
          questId: "q-975",
          title: "Add lightweight cross-thread activity markers",
          stage: "EXPLORING",
          signature: "sig-1",
          workerStatus: "disconnected",
          reviewerStatus: "missing",
          stalledForMs: 571 * 60_000,
          reason: "worker disconnected",
          action: "inspect worker; review findings or revise the Journey",
        },
      }),
    );
    vi.advanceTimersByTime(600);
    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);

    dispatcher.onOrchestratorTurnEnd("orch-1");
    triggerEvent(
      makeEvent({
        id: 2,
        event: "board_stalled",
        ts: 2000,
        data: {
          questId: "q-975",
          title: "Add lightweight cross-thread activity markers",
          stage: "EXPLORING",
          signature: "sig-1",
          workerStatus: "disconnected",
          reviewerStatus: "missing",
          stalledForMs: 572 * 60_000,
          reason: "worker disconnected",
          action: "inspect worker; review findings or revise the Journey",
        },
      }),
    );
    vi.advanceTimersByTime(600);
    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);

    triggerEvent(
      makeEvent({
        id: 3,
        event: "board_stalled",
        ts: 3000,
        data: {
          questId: "q-975",
          title: "Add lightweight cross-thread activity markers",
          stage: "EXPLORING",
          signature: "sig-1",
          workerStatus: "disconnected",
          reviewerStatus: "missing",
          stalledForMs: 573 * 60_000,
          reason: "worker missing",
          action: "inspect worker; review findings or revise the Journey",
        },
      }),
    );
    vi.advanceTimersByTime(600);
    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(2);

    dispatcher.destroy();
  });

  it("delivers a later board_stalled occurrence with the same status and reason", () => {
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");
    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);
    vi.mocked(bridge.getBoardRow!).mockReturnValue({ status: "WORKING" });
    let currentSignature = "";
    vi.mocked(bridge.getBoardStallSignature!).mockImplementation(() => currentSignature);

    const event = (id: number, stalledSince: number) =>
      makeEvent({
        id,
        event: "board_stalled",
        ts: stalledSince + 180_000,
        data: {
          questId: "q-975",
          stage: "WORKING",
          signature: `q-975|WORKING|idle|since:${stalledSince}`,
          stalledSince,
          workerStatus: "idle",
          reviewerStatus: "missing",
          stalledForMs: 180_000,
          reason: "worker idle",
          action: "inspect worker",
        },
      });

    currentSignature = "q-975|WORKING|idle|since:1000";
    triggerEvent(event(1, 1_000));
    vi.advanceTimersByTime(600);
    dispatcher.onOrchestratorTurnEnd("orch-1", "result");
    currentSignature = "q-975|WORKING|idle|since:2000";
    triggerEvent(event(2, 2_000));
    vi.advanceTimersByTime(600);

    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(2);
    dispatcher.destroy();
  });

  it("delivers board_dispatchable events when the next action changes", () => {
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);

    triggerEvent(
      makeEvent({
        id: 1,
        event: "board_dispatchable",
        data: {
          questId: "q-77",
          title: "Dispatch queued follow-up",
          signature: "dispatchable-sig-1",
          summary: "q-77 can be dispatched now: wait-for resolved (q-76).",
          action: "Dispatch it now.",
        },
      }),
    );
    vi.advanceTimersByTime(600);
    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);

    dispatcher.onOrchestratorTurnEnd("orch-1");
    triggerEvent(
      makeEvent({
        id: 2,
        event: "board_dispatchable",
        data: {
          questId: "q-77",
          title: "Dispatch queued follow-up",
          signature: "dispatchable-sig-1",
          summary: "q-77 can be dispatched now: wait-for resolved (q-76).",
          action: "Replace QUEUED with IMPLEMENTING before dispatch.",
        },
      }),
    );
    vi.advanceTimersByTime(600);
    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(2);

    dispatcher.destroy();
  });
});
