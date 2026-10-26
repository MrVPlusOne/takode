// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SessionNotification } from "../types.js";
import { buildNextAttentionQueue } from "../utils/next-attention.js";
import { AttentionItemSections, unreadMessageLabel } from "./AttentionItemRows.js";

/**
 * The attention list's sections: questions, reminders that came due, unread answers grouped by
 * their quest's topic, then watched quests' results. Each unread answer is its own row, named by
 * its words without the thread its summary starts with (the second line names the thread).
 */

function answer(id: string, threadKey: string, timestamp: number, summary: string) {
  return {
    sessionId: "leader",
    threadKey,
    label: threadKey,
    timestamp,
    summary,
    notification: { id, category: "review", timestamp, messageId: `m-${id}`, done: false } as SessionNotification,
  };
}

describe("AttentionItemSections", () => {
  it("groups unread answers under their topic, with the rest under Not in a topic", () => {
    const topics: Record<string, { id: string; name: string }> = { "q-1": { id: "t", name: "Relay" } };
    const queue = buildNextAttentionQueue({
      needsInput: [],
      notifyMe: [],
      unread: [answer("a", "q-1", 300, "Answer in q-1 | Fixed"), answer("b", "q-2", 100, "Report in q-2 | Notes")],
      topicOf: (_sessionId, threadKey) => (threadKey ? (topics[threadKey] ?? null) : null),
    });
    render(<AttentionItemSections items={queue} kinds={["needs-input", "reminder", "unread"]} onOpen={vi.fn()} />);
    const groups = screen.getAllByTestId("attention-topic-group");
    expect(groups.map((group) => group.textContent?.slice(0, 14))).toEqual(["RelayFixedGo t", "Not in a topic"]);
    expect(within(groups[1]!).getByText("Notes")).toBeTruthy();
  });

  it("names an unread message by its words", () => {
    expect(unreadMessageLabel("Answer in q-12 | The fix landed")).toBe("The fix landed");
    expect(unreadMessageLabel("Thread ready: q-12 | complete")).toBe("complete");
    expect(unreadMessageLabel("q-12 ready for review: Show the topic")).toBe("Finished: Show the topic");
    expect(unreadMessageLabel(undefined)).toBe("New result");
  });
});
