// @vitest-environment jsdom
/**
 * A topic page's open quests carry their line of news, as Home shows it (Jiayi, Nov 2: the page
 * listed them as "in progress" only). A quest without one keeps today's status text alone.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { TopicDetail } from "../../../shared/library-topics.js";

const detail: TopicDetail = {
  id: "t1",
  name: "Formal verification",
  questIds: ["q-1", "q-2", "q-3"],
  page: null,
  quests: [
    { questId: "q-1", title: "Disproof credit", status: "in_progress", changedAt: 3, news: "Lean test approved." },
    { questId: "q-2", title: "Goals tool", status: "in_progress", changedAt: 2 },
    { questId: "q-3", title: "Old eval", status: "done", changedAt: 1, completedAt: 1, wrapUp: "Built." },
  ],
} as unknown as TopicDetail;

let shown: TopicDetail = detail;
vi.mock("../../api/topics.js", () => ({ topicApi: { get: vi.fn(async () => shown) } }));
vi.mock("../../api/artifacts.js", () => ({
  artifactApi: { list: vi.fn(async () => ({ artifacts: [], total: 0 })) },
}));

import { TopicView } from "./TopicView.js";

afterEach(() => {
  cleanup();
  shown = detail;
});

describe("TopicView open quests", () => {
  it("shows each open quest's news line under it, one line cut at the end", async () => {
    render(<TopicView id="t1" topics={[]} onBack={() => {}} onChanged={() => {}} />);
    const quests = await screen.findAllByTestId("topic-open-quest");
    expect(quests).toHaveLength(2);
    expect(quests[0]!.textContent).toContain("Disproof credit · in progress");
    const news = within(quests[0]!).getByTestId("topic-open-quest-news");
    expect(news.textContent).toBe("Lean test approved.");
    expect(news.className).toContain("truncate");
    // No news yet: the status text alone.
    expect(within(quests[1]!).queryByTestId("topic-open-quest-news")).toBeNull();
    expect(quests[1]!.textContent).toContain("Goals tool · in progress");
  });
});

describe("TopicView header", () => {
  it("renders the page's intro as Markdown, a line kept beside the summary staying its own with its link", async () => {
    // Jiayi (Nov 6): a "Project roadmap: [title](artifact:...)" line before the scope sentence was
    // shown merged into it as plain text, so the roadmap link was gone.
    shown = {
      ...detail,
      page: "Project roadmap: [Program verification roadmap](artifact:3967bf81)\n\nThe formal-verification effort.\n\n## History\n- **Nov 6** · Roadmap published.",
    };
    render(<TopicView id="t1" topics={[]} onBack={() => {}} onChanged={() => {}} />);
    const lead = await screen.findByTestId("topic-lead");
    const paragraphs = lead.querySelectorAll("p");
    expect([...paragraphs].map((p) => p.textContent)).toEqual([
      "Project roadmap: Program verification roadmap",
      "The formal-verification effort.",
    ]);
    expect(within(lead).getByText("Program verification roadmap").closest("a, button")).not.toBeNull();
  });

  it("says when the Scribe takes up new events, or that it is updating the page", async () => {
    // So the count never reads as a call to click: the page updates itself (Update now stays).
    const dueAt = new Date(2026, 10, 6, 15, 7).getTime();
    vi.useFakeTimers({ now: new Date(2026, 10, 6, 15, 5), toFake: ["Date"] });
    shown = { ...detail, pendingEvents: 2, scribeUpdate: { updating: false, dueAt } };
    render(<TopicView id="t1" topics={[]} onBack={() => {}} onChanged={() => {}} leaderId="leader" />);
    const state = await screen.findByTestId("topic-update-state");
    expect(state.textContent).toMatch(/2 new events · updates by 3:07\sPM · Update now/);
    cleanup();

    shown = { ...detail, pendingEvents: 2, scribeUpdate: { updating: true, dueAt: null } };
    render(<TopicView id="t1" topics={[]} onBack={() => {}} onChanged={() => {}} leaderId="leader" />);
    expect((await screen.findByTestId("topic-update-state")).textContent).toBe("· the Scribe is updating it");
    vi.useRealTimers();
  });
});
