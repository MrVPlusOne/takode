import { describe, expect, it } from "vitest";
import { computeCodexRetainedPayloadBytes, computeReplayHistoryBytes } from "./session-payload-metrics.js";
import type { BrowserIncomingMessage } from "./session-types.js";

function computeSessionPayloadMetrics(
  history: BrowserIncomingMessage[],
  toolResults: Map<string, { content: string }>,
) {
  return {
    replayHistoryBytes: computeReplayHistoryBytes(history),
    codexRetainedPayloadBytes: computeCodexRetainedPayloadBytes(history, toolResults),
  };
}

describe("session payload metrics", () => {
  it("matches replay history bytes when no hidden tool payload exists", () => {
    // Without tool payload deltas or compaction, retained bytes should match
    // the same replay-history payload the browser receives.
    const history: BrowserIncomingMessage[] = [
      {
        type: "tool_result_preview",
        previews: [],
      },
    ];

    const metrics = computeSessionPayloadMetrics(history, new Map());
    const replayBytes = Buffer.byteLength(JSON.stringify(history), "utf-8");

    expect(metrics.replayHistoryBytes).toBe(replayBytes);
    expect(metrics.codexRetainedPayloadBytes).toBe(replayBytes);
  });

  it("adds back hidden full tool-result payload beyond replay previews", () => {
    // Preview entries only carry the truncated browser-facing tail, so the
    // retained estimate must add back the hidden full-result delta.
    const preview = "x".repeat(300);
    const full = "x".repeat(2_000);
    const history: BrowserIncomingMessage[] = [
      {
        type: "tool_result_preview",
        previews: [
          {
            tool_use_id: "tool-1",
            content: preview,
            is_error: false,
            total_size: full.length,
            is_truncated: true,
          },
        ],
      },
    ];

    const metrics = computeSessionPayloadMetrics(
      history,
      new Map([
        [
          "tool-1",
          {
            content: full,
          },
        ],
      ]),
    );

    const replayBytes = Buffer.byteLength(JSON.stringify(history), "utf-8");
    expect(metrics.replayHistoryBytes).toBe(replayBytes);
    expect(metrics.codexRetainedPayloadBytes).toBe(
      replayBytes + Buffer.byteLength(full, "utf-8") - Buffer.byteLength(preview, "utf-8"),
    );
  });

  it("falls back to preview total_size when the indexed full result is missing", () => {
    // Resume or indexing gaps can leave a preview without its full indexed
    // payload; in that case retained bytes should still use preview.total_size
    // as a byte count, including non-ASCII output.
    const preview = "é".repeat(300);
    const totalSizeBytes = Buffer.byteLength("é".repeat(700), "utf-8");
    const history: BrowserIncomingMessage[] = [
      {
        type: "tool_result_preview",
        previews: [
          {
            tool_use_id: "tool-missing",
            content: preview,
            is_error: false,
            total_size: totalSizeBytes,
            is_truncated: true,
          },
        ],
      },
    ];

    const metrics = computeSessionPayloadMetrics(history, new Map());
    const replayBytes = Buffer.byteLength(JSON.stringify(history), "utf-8");

    expect(metrics.replayHistoryBytes).toBe(replayBytes);
    expect(metrics.codexRetainedPayloadBytes).toBe(replayBytes + totalSizeBytes - Buffer.byteLength(preview, "utf-8"));
  });

  it("drops pre-compaction payload from retained bytes after the latest compact marker", () => {
    // Only the active post-compaction segment should count toward retained
    // payload; older browser-only history must remain visible but not counted.
    const oldPreview = "o".repeat(300);
    const newPreview = "n".repeat(300);
    const history: BrowserIncomingMessage[] = [
      {
        type: "tool_result_preview",
        previews: [
          {
            tool_use_id: "tool-old",
            content: oldPreview,
            is_error: false,
            total_size: 1_000,
            is_truncated: true,
          },
        ],
      },
      {
        type: "compact_marker",
        timestamp: 1,
        id: "compact-boundary-1",
        summary: "Retained summary",
      },
      {
        type: "tool_result_preview",
        previews: [
          {
            tool_use_id: "tool-new",
            content: newPreview,
            is_error: false,
            total_size: 1_200,
            is_truncated: true,
          },
        ],
      },
    ];

    const metrics = computeSessionPayloadMetrics(
      history,
      new Map([
        ["tool-old", { content: "o".repeat(1_000) }],
        ["tool-new", { content: "n".repeat(1_200) }],
      ]),
    );

    const retainedHistory = history.slice(1);
    const retainedHistoryBytes = Buffer.byteLength(JSON.stringify(retainedHistory), "utf-8");

    expect(metrics.replayHistoryBytes).toBe(Buffer.byteLength(JSON.stringify(history), "utf-8"));
    expect(metrics.codexRetainedPayloadBytes).toBe(
      retainedHistoryBytes + Buffer.byteLength("n".repeat(1_200), "utf-8") - Buffer.byteLength(newPreview, "utf-8"),
    );
  });

  it("matches a full serialization while reusing cached sizes of older entries", () => {
    // Sizes are cached per entry so leader-sized histories are not reserialized on
    // every subscribe and turn end. The total must still equal the serialized
    // array, including non-ASCII text, and an entry still among the newest ones
    // may grow in place (a turn's assistant message gains content blocks).
    const history: BrowserIncomingMessage[] = Array.from({ length: 60 }, (_, index) => ({
      type: "user_message",
      id: `u-${index}`,
      content: `message ${index} ✓ é`,
      timestamp: index,
    }));
    expect(computeReplayHistoryBytes(history)).toBe(Buffer.byteLength(JSON.stringify(history), "utf-8"));

    const tail = history.at(-1) as Extract<BrowserIncomingMessage, { type: "user_message" }>;
    tail.content += " grown in place";
    history.push({ type: "user_message", id: "u-new", content: "appended", timestamp: 61 });
    expect(computeReplayHistoryBytes(history)).toBe(Buffer.byteLength(JSON.stringify(history), "utf-8"));
    expect(computeReplayHistoryBytes([])).toBe(2);
  });
});
