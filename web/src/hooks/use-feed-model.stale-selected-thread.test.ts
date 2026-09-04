import { describe, expect, it } from "vitest";
import {
  staleSelectedThreadHistoryFixture,
  staleSelectedThreadKey,
} from "../../shared/test-fixtures/stale-selected-thread-window.js";
import { buildThreadWindowSync } from "../../shared/thread-window.js";
import { normalizeHistoryMessageToChatMessages } from "../utils/history-message-normalization.js";
import { buildFeedModel } from "./use-feed-model.js";

describe("selected-thread collapsed projection", () => {
  it("keeps routed herd activity inspectable while unproven legacy prose stays behind expansion", () => {
    // The browser consumes the exact server-authored window shape rather than
    // inventing a frontend-only thread payload.
    const sync = buildThreadWindowSync({
      messageHistory: staleSelectedThreadHistoryFixture,
      threadKey: staleSelectedThreadKey,
      fromItem: -1,
      itemCount: 50,
      sectionItemCount: 10,
      visibleItemCount: 5,
    });
    const messages = sync.entries.flatMap((entry) =>
      entry.message.type === "tool_result_preview"
        ? []
        : normalizeHistoryMessageToChatMessages(entry.message, entry.history_index),
    );
    const model = buildFeedModel(messages, true);

    expect(model.turns).toHaveLength(1);
    expect(model.turns[0]?.stats.herdEventCount).toBe(6);
    expect(
      model.turns[0]?.collapsedEntries?.some((entry) => entry.kind === "activity" && entry.stats.herdEventCount === 6),
    ).toBe(true);
    const visibleIds = model.turns[0]?.collapsedEntries
      ?.filter((entry) => entry.kind === "entry" && entry.entry.kind === "message")
      .map((entry) => (entry.kind === "entry" && entry.entry.kind === "message" ? entry.entry.msg.id : null));
    expect(visibleIds).toEqual([]);
    expect(
      model.turns[0]?.agentEntries
        .filter((entry) => entry.kind === "message")
        .map((entry) => (entry.kind === "message" ? entry.msg.id : null)),
    ).toEqual(expect.arrayContaining(["leader-response-one", "leader-response-two"]));
  });
});
