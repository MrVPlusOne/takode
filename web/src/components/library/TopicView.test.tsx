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

vi.mock("../../api/topics.js", () => ({ topicApi: { get: vi.fn(async () => detail) } }));
vi.mock("../../api/artifacts.js", () => ({
  artifactApi: { list: vi.fn(async () => ({ artifacts: [], total: 0 })) },
}));

import { TopicView } from "./TopicView.js";

afterEach(cleanup);

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
