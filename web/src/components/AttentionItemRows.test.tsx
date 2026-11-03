// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SessionNotification } from "../types.js";
import { LEADER_PROFILE_PORTRAITS } from "../../shared/leader-profile-portraits.js";
import { buildNextAttentionQueue, countAttentionPlaces } from "../utils/next-attention.js";
import { AttentionItemSections, unreadMessageLabel } from "./AttentionItemRows.js";

/**
 * The attention list's sections: questions, reminders that came due, unread answers grouped by
 * thread, then watched quests' results. Each unread answer is its own row, named by
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
  it("shows one row per thread with what is new there, answers to one request counted once", () => {
    // Jiayi found per-message counts overwhelming: the list shows each thread once, saying how
    // many new answers it has; two answers to the same request are one. Threads are the unit
    // (Jiayi, Nov 2): they were grouped by Library topic before.
    const withRequest = (item: ReturnType<typeof answer>, request: string) => ({
      ...item,
      notification: { ...item.notification, answerTo: [request] },
    });
    const queue = buildNextAttentionQueue({
      needsInput: [],
      notifyMe: [],
      unread: [
        withRequest(answer("a", "q-3", 300, "Answer in q-3 | Fixed"), "u7"),
        withRequest(answer("c", "q-3", 250, "Answer in q-3 | Also fixed"), "u7"),
        answer("d", "q-3", 200, "Answer in q-3 | Separate"),
        answer("b", "q-2", 100, "Report in q-2 | Notes"),
      ],
    });
    expect(countAttentionPlaces(queue)).toBe(2);
    const threads = {
      titleFor: (_sessionId: string, threadKey: string) => (threadKey === "q-3" ? "Relay proxy" : "Voice notes"),
      roundTitleFor: (threadKey: string) => (threadKey === "q-2" ? "Mic picker" : undefined),
      hasThreadTabs: () => true,
    };
    render(
      <AttentionItemSections
        items={queue}
        kinds={["unread"]}
        onOpen={vi.fn()}
        threads={threads}
        sessionLabelFor={() => "#7 Daily Leader"}
        portraitFor={() => LEADER_PROFILE_PORTRAITS[0]}
      />,
    );
    const rows = screen.getAllByTestId("attention-place-row");
    expect(rows).toHaveLength(2);
    // Across sessions a row shows its leader's portrait, named on hover.
    expect(rows[0]!.querySelector("img")).not.toBeNull();
    expect(rows[0]!.querySelector('[title="#7 Daily Leader"]')).not.toBeNull();
    // A quest is named by its title, its number on hover, as in the Threads view.
    const name = within(rows[0]!).getByTestId("attention-place-name");
    expect(name.textContent).toBe("Relay proxy");
    expect(name.getAttribute("title")).toBe("q-3 Relay proxy");
    expect(within(rows[0]!).getByTestId("attention-place-summary").textContent).toContain("2 new answers");
    // A reopened quest by its newest round, then the quest.
    expect(within(rows[1]!).getByTestId("quest-round-title").textContent).toBe("Mic picker");
    expect(within(rows[1]!).getByTestId("quest-round-title-quest").textContent).toBe("Voice notes");
    expect(within(rows[1]!).getByTestId("attention-place-summary").textContent).toContain("1 new answer");
  });

  it("names a row's topic before its thread when asked, once when the thread is the topic itself", () => {
    // A session's own list names each row's topic in place of the session ("Topic › q-7 Title"),
    // like the breadcrumb. A topic's own conversation is named by the topic already, so no repeat.
    const queue = buildNextAttentionQueue({
      needsInput: ["q-7", "topic:relay"].map((threadKey, index) => ({
        sessionId: "leader",
        sessionName: "Leader",
        sessionNum: 1,
        notification: {
          id: `ask-${index}`,
          category: "needs-input",
          summary: `Ask ${index}`,
          timestamp: 10 - index,
          threadKey,
          done: false,
        } as SessionNotification,
      })),
      notifyMe: [],
      unread: [],
    });
    const threads = {
      titleFor: (_sessionId: string, threadKey: string) => (threadKey === "q-7" ? "Offline hosts" : "Relay"),
      hasThreadTabs: () => true,
    };
    render(
      <AttentionItemSections
        items={queue}
        kinds={["needs-input"]}
        onOpen={vi.fn()}
        threads={threads}
        topicFor={() => "Relay"}
      />,
    );
    const [quest, topic] = screen.getAllByTestId("attention-item-place");
    expect(quest!.textContent).toMatch(/^Relay›q-7 Offline hosts/);
    expect(within(topic!).queryByTestId("attention-item-topic")).toBeNull();
    expect(topic!.textContent).toMatch(/^Relay·/);
  });

  it("names a user thread's place by the thread's name, not its key", () => {
    // Threads the user started have keys like topic:55badbba; the row read "topic:55badbba
    // topic:55badbba" until it took the thread's name.
    const queue = buildNextAttentionQueue({
      needsInput: [],
      notifyMe: [],
      unread: [answer("t", "topic:55badbba", 300, 'Answer in Thread "Prod memory" | About 2.2 GB')],
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
    // An answer the leader marked urgent is not folded into its thread's row: it gets its own
    // row in the Urgent section, named by its words, with the urgent mark.
    const urgent = answer("u", "q-1", 300, "Answer in q-1 | Encore replied");
    urgent.notification = { ...urgent.notification, urgent: true };
    const queue = buildNextAttentionQueue({
      needsInput: [],
      notifyMe: [],
      unread: [urgent, answer("a", "q-1", 200, "Answer in q-1 | Fixed")],
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
