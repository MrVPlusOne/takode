// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SessionNotification } from "../types.js";
import { buildNextAttentionQueue, countAttentionPlaces } from "../utils/next-attention.js";
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
  it("shows one row per place with what is new there, answers to one request counted once", () => {
    // Jiayi found per-message counts overwhelming: the list shows each topic (or quest outside
    // topics) once, saying how many new answers it has; two answers to the same request are one.
    const topics: Record<string, { id: string; name: string }> = {
      "q-1": { id: "t", name: "Relay" },
      "q-3": { id: "t", name: "Relay" },
    };
    const withRequest = (item: ReturnType<typeof answer>, request: string) => ({
      ...item,
      notification: { ...item.notification, answerTo: [request] },
    });
    const queue = buildNextAttentionQueue({
      needsInput: [],
      notifyMe: [],
      unread: [
        withRequest(answer("a", "q-1", 300, "Answer in q-1 | Fixed"), "u7"),
        withRequest(answer("c", "q-3", 250, "Answer in q-3 | Also fixed"), "u7"),
        answer("d", "q-3", 200, "Answer in q-3 | Separate"),
        answer("b", "q-2", 100, "Report in q-2 | Notes"),
      ],
      topicOf: (_sessionId, threadKey) => (threadKey ? (topics[threadKey] ?? null) : null),
    });
    expect(countAttentionPlaces(queue)).toBe(2);
    render(<AttentionItemSections items={queue} kinds={["unread"]} onOpen={vi.fn()} />);
    const rows = screen.getAllByTestId("attention-place-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toMatch(/^Relay/);
    expect(within(rows[0]!).getByTestId("attention-place-summary").textContent).toContain("2 new answers");
    expect(within(rows[1]!).getByTestId("attention-place-summary").textContent).toContain("1 new answer");
  });

  it("names a user thread's place by the thread's name, not its key", () => {
    // Threads the user started have keys like topic:55badbba; the row read "topic:55badbba
    // topic:55badbba" until it took the thread's name.
    const queue = buildNextAttentionQueue({
      needsInput: [],
      notifyMe: [],
      unread: [answer("t", "topic:55badbba", 300, 'Answer in Thread "Prod memory" | About 2.2 GB')],
      topicOf: () => null,
    });
    const threads = {
      titleFor: (_sessionId: string, threadKey: string) => (threadKey === "topic:55badbba" ? "Prod memory" : undefined),
      hasThreadTabs: () => true,
    };
    render(<AttentionItemSections items={queue} kinds={["unread"]} onOpen={vi.fn()} threads={threads} />);
    const row = screen.getByTestId("attention-place-row");
    expect(row.textContent).toMatch(/^Prod memory/);
    expect(row.textContent).not.toContain("topic:");
  });

  it("lists urgent answers in their own Urgent section, one row each, marked urgent", () => {
    // An answer the leader marked urgent is not folded into its topic's row: it gets its own
    // row in the Urgent section, named by its words, with the urgent mark.
    const urgent = answer("u", "q-1", 300, "Answer in q-1 | Encore replied");
    urgent.notification = { ...urgent.notification, urgent: true };
    const queue = buildNextAttentionQueue({
      needsInput: [],
      notifyMe: [],
      unread: [urgent, answer("a", "q-1", 200, "Answer in q-1 | Fixed")],
      topicOf: () => ({ id: "t", name: "Relay" }),
    });
    render(<AttentionItemSections items={queue} kinds={["urgent", "unread"]} onOpen={vi.fn()} />);
    const urgentSection = screen.getByRole("region", { name: "Urgent results" });
    const urgentRow = within(urgentSection).getByTestId("attention-item-row");
    expect(urgentRow.getAttribute("data-attention-kind")).toBe("urgent");
    expect(urgentRow.textContent).toContain("Encore replied");
    expect(
      within(screen.getByRole("region", { name: "Unread results" })).getAllByTestId("attention-place-row"),
    ).toHaveLength(1);
  });

  it("names an unread message by its words", () => {
    expect(unreadMessageLabel("Answer in q-12 | The fix landed")).toBe("The fix landed");
    expect(unreadMessageLabel("Thread ready: q-12 | complete")).toBe("complete");
    expect(unreadMessageLabel("q-12 ready for review: Show the topic")).toBe("Finished: Show the topic");
    expect(unreadMessageLabel(undefined)).toBe("New result");
  });
});
