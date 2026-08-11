import { describe, expect, it } from "vitest";
import {
  staleSelectedThreadHerdIds,
  staleSelectedThreadHistoryFixture,
  staleSelectedThreadKey,
} from "./test-fixtures/stale-selected-thread-window.js";
import { buildThreadWindowSync } from "./thread-window.js";

describe("selected-thread producer replay", () => {
  it("retains stable routed herd identities and attached source context in the authoritative latest window", () => {
    // Sanitized producer-shaped regression: an installed selected-thread window
    // may be stale while routed activity accumulates in authoritative history.
    const sync = buildThreadWindowSync({
      messageHistory: staleSelectedThreadHistoryFixture,
      threadKey: staleSelectedThreadKey,
      fromItem: -1,
      itemCount: 50,
      sectionItemCount: 10,
      visibleItemCount: 5,
    });

    const ids = sync.entries.map((entry) =>
      entry.message.type === "assistant" ? entry.message.message.id : "id" in entry.message ? entry.message.id : null,
    );
    for (const id of staleSelectedThreadHerdIds) expect(ids.filter((candidate) => candidate === id)).toHaveLength(1);
    expect(ids.filter((candidate) => candidate === "user-main-source")).toHaveLength(1);
    expect(ids).toContain("leader-response-one");
    expect(ids).toContain("leader-response-two");
    expect(sync.entries.some((entry) => entry.message.type === "thread_attachment_marker")).toBe(false);
    expect(sync.window.source_history_length).toBe(staleSelectedThreadHistoryFixture.length);
  });
});
