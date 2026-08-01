// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beginHistoryReceiveRenderTiming,
  beginThreadNavigationTiming,
  clearFrontendPerfSessionCorrelations,
  clearFrontendPerfEntries,
  completeHistoryReceiveRenderTiming,
  exportFrontendPerfEntries,
  getFrontendPerfEntries,
  markHistoryReceiveRenderCommitted,
  markThreadNavigationCommitted,
  recordFeedRenderSnapshot,
  recordFrontendPerfEntry,
} from "./frontend-perf-recorder.js";

afterEach(() => {
  clearFrontendPerfEntries();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("frontend perf recorder", () => {
  it("keeps a bounded inspectable ring buffer", () => {
    for (let i = 0; i < 1_010; i++) {
      recordFrontendPerfEntry({
        kind: "ws_message",
        timestamp: i,
        sessionId: "s1",
        messageType: "stream_event",
        durationMs: 1,
        seq: i,
      });
    }

    const entries = getFrontendPerfEntries();
    expect(entries).toHaveLength(1_000);
    expect(entries[0]).toMatchObject({ kind: "ws_message", seq: 10 });
    expect(window.__TAKODE_FRONTEND_PERF__?.entries()).toHaveLength(1_000);
    expect(JSON.parse(exportFrontendPerfEntries())).toHaveLength(1_000);
  });

  it("deduplicates unchanged feed render snapshots", () => {
    recordFeedRenderSnapshot({ sessionId: "s1", threadKey: "main", messageCount: 3, entryCount: 2, turnCount: 1 });
    recordFeedRenderSnapshot({ sessionId: "s1", threadKey: "main", messageCount: 3, entryCount: 2, turnCount: 1 });
    recordFeedRenderSnapshot({ sessionId: "s1", threadKey: "q-1", messageCount: 3, entryCount: 2, turnCount: 1 });

    expect(getFrontendPerfEntries()).toEqual([
      expect.objectContaining({ kind: "feed_render", sessionId: "s1", threadKey: "main" }),
      expect.objectContaining({ kind: "feed_render", sessionId: "s1", threadKey: "q-1" }),
    ]);
  });

  it("records composer autocomplete diagnostics", () => {
    recordFrontendPerfEntry({
      kind: "composer_autocomplete",
      timestamp: 1,
      sessionId: "s1",
      threadKey: "main",
      phase: "reference_suggestions",
      durationMs: 2,
      referenceKind: "quest",
      queryLength: 0,
      historyEntryCount: 12,
      historyCharCount: 345,
      scannedQuestCount: 50,
      candidateCount: 50,
      suggestionCount: 8,
    });

    expect(window.__TAKODE_FRONTEND_PERF__?.entries()).toEqual([
      expect.objectContaining({
        kind: "composer_autocomplete",
        phase: "reference_suggestions",
        referenceKind: "quest",
        scannedQuestCount: 50,
      }),
    ]);
  });

  it("records metadata-only parse, apply, commit, and next-paint stages for history frames", () => {
    // The correlated record intentionally exposes only sizes, timings, type, and an opaque local receive ID.
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    const now = vi.spyOn(performance, "now");

    beginHistoryReceiveRenderTiming({
      receiveId: "receive-1",
      sessionId: "s1",
      messageType: "leader_projection_snapshot",
      payloadUtf16CodeUnits: 12_345,
      receivedAt: 10,
      parseDurationMs: 4,
    });
    now.mockReturnValueOnce(25);
    markHistoryReceiveRenderCommitted("s1");
    completeHistoryReceiveRenderTiming({ receiveId: "receive-1", appliedAt: 20, applyDurationMs: 6 });

    expect(getFrontendPerfEntries()).toEqual([]);
    frames.shift()?.(30);
    now.mockReturnValueOnce(50);
    frames.shift()?.(40);

    expect(getFrontendPerfEntries()).toEqual([
      {
        kind: "history_receive_render",
        timestamp: expect.any(Number),
        sessionId: "s1",
        messageType: "leader_projection_snapshot",
        receiveId: "receive-1",
        payloadUtf16CodeUnits: 12_345,
        parseDurationMs: 4,
        applyDurationMs: 6,
        reactCommitDurationMs: 5,
        nextPaintDurationMs: 25,
        totalDurationMs: 40,
      },
    ]);
  });

  it("records cached thread navigation from selection through commit and next paint", () => {
    // Warm navigation has no receive frame, so it needs its own bounded metadata-only correlation.
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    const now = vi.spyOn(performance, "now");
    now.mockReturnValueOnce(10);
    beginThreadNavigationTiming({
      sessionId: "s1",
      fromThreadKey: "main",
      toThreadKey: "q-1",
      cachedWindow: true,
    });
    now.mockReturnValueOnce(25);
    markThreadNavigationCommitted("s1", "q-1");
    frames.shift()?.(30);
    now.mockReturnValueOnce(50);
    frames.shift()?.(40);

    expect(getFrontendPerfEntries()).toEqual([
      expect.objectContaining({
        kind: "thread_navigation",
        sessionId: "s1",
        fromThreadKey: "main",
        toThreadKey: "q-1",
        cachedWindow: true,
        reactCommitDurationMs: 15,
        nextPaintDurationMs: 25,
        totalDurationMs: 40,
      }),
    ]);
  });

  it("drops orphaned, globally excess, and session-closed receive correlations", () => {
    // Cleanup is activity-driven: no recurring timer or payload scan is added to the mobile hot path.
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    beginHistoryReceiveRenderTiming({
      receiveId: "aged-receive",
      sessionId: "aged-session",
      messageType: "thread_window_sync",
      payloadUtf16CodeUnits: 10,
      receivedAt: 0,
      parseDurationMs: 1,
    });
    beginHistoryReceiveRenderTiming({
      receiveId: "fresh-receive",
      sessionId: "fresh-session",
      messageType: "thread_window_sync",
      payloadUtf16CodeUnits: 10,
      receivedAt: 30_001,
      parseDurationMs: 1,
    });
    completeHistoryReceiveRenderTiming({ receiveId: "aged-receive", appliedAt: 30_002, applyDurationMs: 1 });
    markHistoryReceiveRenderCommitted("aged-session");
    clearFrontendPerfSessionCorrelations("fresh-session");

    for (let index = 0; index < 101; index++) {
      beginHistoryReceiveRenderTiming({
        receiveId: `receive-${index}`,
        sessionId: `session-${index}`,
        messageType: "thread_window_sync",
        payloadUtf16CodeUnits: 10,
        receivedAt: index,
        parseDurationMs: 1,
      });
    }
    completeHistoryReceiveRenderTiming({ receiveId: "receive-0", appliedAt: 102, applyDurationMs: 1 });
    markHistoryReceiveRenderCommitted("session-0");

    completeHistoryReceiveRenderTiming({ receiveId: "receive-100", appliedAt: 102, applyDurationMs: 1 });
    markHistoryReceiveRenderCommitted("session-100");
    clearFrontendPerfSessionCorrelations("session-100");
    while (frames.length > 0) frames.shift()?.(0);

    expect(getFrontendPerfEntries()).toEqual([]);
  });

  it("globally bounds pending warm thread navigation correlations", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    for (let index = 0; index < 101; index++) {
      beginThreadNavigationTiming({
        sessionId: `session-${index}`,
        fromThreadKey: "main",
        toThreadKey: "q-1",
        cachedWindow: true,
      });
    }

    markThreadNavigationCommitted("session-0", "q-1");
    markThreadNavigationCommitted("session-100", "q-1");
    frames.shift()?.(0);
    frames.shift()?.(0);

    expect(getFrontendPerfEntries()).toEqual([
      expect.objectContaining({ kind: "thread_navigation", sessionId: "session-100" }),
    ]);
  });
});
