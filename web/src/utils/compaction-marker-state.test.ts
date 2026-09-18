import { describe, expect, it } from "vitest";
import { normalizeHistoryMessageToChatMessages } from "./history-message-normalization.js";
import { compactionMarkerLabel, type CompactionMarkerMessage } from "../../shared/compaction-marker.js";

describe("compaction history status", () => {
  it.each([
    "started",
    "completed",
  ] as const)("retains the producer's %s status through history normalization", (compactionStatus) => {
    // Consume the same marker contract the backend publishes, not a UI-only fixture.
    const marker: CompactionMarkerMessage = {
      type: "compact_marker",
      id: "compact-boundary-event",
      timestamp: 20,
      compactionStatus,
    };
    const [message] = normalizeHistoryMessageToChatMessages(marker, 4);
    expect(message.metadata?.compactionStatus).toBe(compactionStatus);
    expect(message.content).toBe(compactionMarkerLabel(compactionStatus));
    expect(message.historyIndex).toBe(4);
  });
});
