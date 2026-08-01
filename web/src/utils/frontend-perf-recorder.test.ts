// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beginHistoryReceiveRenderTiming,
  clearFrontendPerfEntries,
  completeHistoryReceiveRenderTiming,
  exportFrontendPerfEntries,
  getFrontendPerfEntries,
  markHistoryReceiveRenderCommitted,
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
      payloadBytes: 12_345,
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
        payloadBytes: 12_345,
        parseDurationMs: 4,
        applyDurationMs: 6,
        reactCommitDurationMs: 5,
        nextPaintDurationMs: 25,
        totalDurationMs: 40,
      },
    ]);
  });
});
