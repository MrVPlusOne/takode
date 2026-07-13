// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { QuestmasterTask } from "../types.js";
import { useStore } from "../store.js";
import { api } from "../api.js";
import { QuestInlineLink } from "./QuestInlineLink.js";

vi.mock("../api.js", () => ({
  api: {
    getQuestValidated: vi.fn(),
  },
}));

const mockGetQuestValidated = vi.mocked(api.getQuestValidated);

function quest(overrides: Partial<QuestmasterTask> & { questId: string; title: string }): QuestmasterTask {
  const { questId, title, ...rest } = overrides;
  return {
    id: questId,
    questId,
    version: 1,
    status: "idea",
    title,
    createdAt: 1,
    ...rest,
  } as QuestmasterTask;
}

describe("QuestInlineLink", () => {
  beforeEach(() => {
    useStore.getState().reset();
    mockGetQuestValidated.mockReset();
    window.location.hash = "#/session/s1";
  });

  it("keeps hover metadata lookup working with many quest links", () => {
    useStore.setState({
      quests: Array.from({ length: 300 }, (_, index) =>
        quest({ questId: `q-${index + 1}`, title: `Quest ${index + 1}` }),
      ),
    });

    render(<QuestInlineLink questId="q-240" />);
    fireEvent.mouseEnter(screen.getByText("q-240"));

    expect(screen.getByTestId("quest-hover-title").textContent).toBe("Quest 240");
    expect(mockGetQuestValidated).not.toHaveBeenCalled();
  });

  it("fetches an uncached quest by id on hover and renders the rich preview", async () => {
    // Regression coverage: links in chat can reference quests that have not been opened into detail cache yet.
    const fetched = quest({
      questId: "q-240",
      title: "Fetched hover preview",
      tldr: "Loaded from the bounded detail endpoint.",
    });
    mockGetQuestValidated.mockResolvedValueOnce({ status: "fresh", data: fetched, etag: '"detail-v1"' });

    render(<QuestInlineLink questId="q-240" />);
    fireEvent.mouseEnter(screen.getByText("q-240"));

    expect(mockGetQuestValidated).toHaveBeenCalledWith("q-240", null);
    await waitFor(() => expect(screen.getByTestId("quest-hover-title").textContent).toBe("Fetched hover preview"));
    expect(screen.getByTestId("quest-hover-tldr").textContent).toContain("Loaded from the bounded detail endpoint.");
    expect(useStore.getState().questDetails.get("q-240")).toBe(fetched);
    expect(useStore.getState().questDetailEtags.get("q-240")).toBe('"detail-v1"');
  });

  it("marks an uncached hover as loading while the by-id preview fetch is pending", async () => {
    // Slow uncached hovers should expose useful native title text instead of only the stale "Open" tooltip.
    const fetched = quest({ questId: "q-66", title: "Loaded after hover" });
    let resolveFetch: (result: Awaited<ReturnType<typeof api.getQuestValidated>>) => void = () => {};
    mockGetQuestValidated.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    render(<QuestInlineLink questId="q-66" />);
    const link = screen.getByText("q-66");

    fireEvent.mouseEnter(link);

    expect(link.getAttribute("title")).toBe("Loading q-66 preview");
    resolveFetch({ status: "fresh", data: fetched, etag: null });
    await waitFor(() => expect(link.getAttribute("title")).toBe("Open q-66"));
  });

  it("marks an uncached hover as unavailable when the by-id preview fetch fails", async () => {
    // Failed hover preloads should not render an empty rich card; clicking still opens the normal detail panel path.
    mockGetQuestValidated.mockRejectedValueOnce(new Error("Quest not found"));

    render(<QuestInlineLink questId="q-404" />);
    const link = screen.getByText("q-404");

    fireEvent.mouseEnter(link);

    await waitFor(() => expect(link.getAttribute("title")).toBe("Preview unavailable for q-404"));
    expect(screen.queryByTestId("quest-hover-card")).toBeNull();
  });

  it("reuses cached detail data without refetching", () => {
    // Cached detail records are already sufficient for the hover card and should not trigger redundant fetches.
    const cached = quest({ questId: "q-77", title: "Cached hover preview" });
    useStore.setState({
      questDetails: new Map([["q-77", cached]]),
      questDetailEtags: new Map([["q-77", '"cached-v1"']]),
    });

    render(<QuestInlineLink questId="q-77" />);
    fireEvent.mouseEnter(screen.getByText("q-77"));

    expect(screen.getByTestId("quest-hover-title").textContent).toBe("Cached hover preview");
    expect(mockGetQuestValidated).not.toHaveBeenCalled();
  });

  it("coalesces duplicate uncached hover fetches for the same quest", async () => {
    // Multiple rendered links can point at the same quest; only one by-id request should be in flight.
    const fetched = quest({ questId: "q-88", title: "Shared hover fetch" });
    let resolveFetch: (result: Awaited<ReturnType<typeof api.getQuestValidated>>) => void = () => {};
    mockGetQuestValidated.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    render(
      <div>
        <QuestInlineLink questId="q-88">first link</QuestInlineLink>
        <QuestInlineLink questId="q-88">second link</QuestInlineLink>
      </div>,
    );

    fireEvent.mouseEnter(screen.getByText("first link"));
    fireEvent.mouseEnter(screen.getByText("second link"));

    expect(mockGetQuestValidated).toHaveBeenCalledTimes(1);
    resolveFetch({ status: "fresh", data: fetched, etag: null });
    await waitFor(() => expect(useStore.getState().questDetails.get("q-88")).toBe(fetched));
  });
});
