import { describe, expect, it } from "vitest";
import { CodexItemEventManager } from "./codex-item-event-manager.js";
import type { BrowserIncomingMessage } from "./session-types.js";

function compactionStartedParams(id: string) {
  return {
    threadId: "thread-1",
    turnId: "turn-1",
    item: { id, type: "contextCompaction", status: "inProgress" },
  };
}

describe("CodexItemEventManager compaction attribution", () => {
  it("emits cause unknown for an unmarked app-server compaction item", () => {
    // app-server's item contains no trigger reason or active-context counter.
    const emitted: BrowserIncomingMessage[] = [];
    const manager = new CodexItemEventManager((message) => emitted.push(message), {});

    manager.handleItemStarted(compactionStartedParams("compact-auto"));

    expect(emitted).toContainEqual({
      type: "status_change",
      status: "compacting",
      codexCompactionCause: "unknown",
    });
  });

  it("keeps manual request correlation bounded by its expiry window", () => {
    // A stale in-memory /compact marker must not classify a later unrelated
    // compaction as manual after the correlation window has expired.
    const emitted: BrowserIncomingMessage[] = [];
    const manager = new CodexItemEventManager((message) => emitted.push(message), {});
    manager.markNextCompactionCause("manual", Date.now() - 61_000);

    manager.handleItemStarted(compactionStartedParams("compact-late"));

    expect(emitted).toContainEqual({
      type: "status_change",
      status: "compacting",
      codexCompactionCause: "unknown",
    });
  });
});
