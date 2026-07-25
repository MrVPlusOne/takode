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

  it("uses the theme-readable quest link color by default", () => {
    // Quest links appear in light and dark chrome, so the default must be a
    // theme token instead of a hard-coded bright Tailwind blue.
    render(<QuestInlineLink questId="q-12" />);

    const link = screen.getByRole("link", { name: "q-12" });
    expect(link.className).toContain("cc-quest-link");
    expect(link.className).not.toContain("text-blue-300");
  });

  it("keeps hover metadata lookup working with many quest links after bounded revalidation", async () => {
    // Cached list data is useful lookup input, but hover status/title metadata must still be validated by id.
    const cached = quest({ questId: "q-240", title: "Quest 240", status: "refined" });
    const fresh = quest({ questId: "q-240", title: "Quest 240", status: "done", completedAt: Date.now() });
    useStore.setState({
      quests: Array.from({ length: 300 }, (_, index) =>
        index + 1 === 240 ? cached : quest({ questId: `q-${index + 1}`, title: `Quest ${index + 1}` }),
      ),
    });
    mockGetQuestValidated.mockResolvedValueOnce({ status: "fresh", data: fresh, etag: '"detail-v2"' });

    render(<QuestInlineLink questId="q-240" />);
    fireEvent.mouseEnter(screen.getByText("q-240"));

    expect(mockGetQuestValidated).toHaveBeenCalledWith("q-240", null);
    expect(screen.queryByTestId("quest-hover-card")).toBeNull();
    await waitFor(() => expect(screen.getByTestId("quest-hover-title").textContent).toBe("Quest 240"));
    expect(screen.getByTestId("quest-hover-status-chip").textContent).toContain("Completed");
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

  it("revalidates cached detail with its ETag and preserves it on 304", async () => {
    // Cached detail can render after the cheap freshness check confirms the backend has not changed.
    const cached = quest({ questId: "q-77", title: "Cached hover preview", status: "refined" });
    let resolveFetch: (result: Awaited<ReturnType<typeof api.getQuestValidated>>) => void = () => {};
    mockGetQuestValidated.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    useStore.setState({
      questDetails: new Map([["q-77", cached]]),
      questDetailEtags: new Map([["q-77", '"cached-v1"']]),
    });

    render(<QuestInlineLink questId="q-77" />);
    fireEvent.mouseEnter(screen.getByText("q-77"));

    expect(mockGetQuestValidated).toHaveBeenCalledWith("q-77", '"cached-v1"');
    expect(screen.queryByTestId("quest-hover-card")).toBeNull();
    resolveFetch({ status: "not-modified", etag: '"cached-v1"' });

    await waitFor(() => expect(screen.getByTestId("quest-hover-title").textContent).toBe("Cached hover preview"));
    expect(screen.getByTestId("quest-hover-status-chip").textContent).toContain("Refined");
    expect(useStore.getState().questDetails.get("q-77")).toBe(cached);
    expect(useStore.getState().questDetailEtags.get("q-77")).toBe('"cached-v1"');
  });

  it("replaces stale cached hover status after fresh by-id revalidation", async () => {
    // Regression coverage: a quest completed elsewhere must not leave the hover preview showing the old lifecycle state.
    const stale = quest({ questId: "q-77", title: "Cached hover preview", status: "refined" });
    const fresh = quest({
      questId: "q-77",
      title: "Cached hover preview",
      status: "done",
      completedAt: Date.now(),
    });
    let resolveFetch: (result: Awaited<ReturnType<typeof api.getQuestValidated>>) => void = () => {};
    mockGetQuestValidated.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    useStore.setState({
      questDetails: new Map([["q-77", stale]]),
      questDetailEtags: new Map([["q-77", '"detail-v1"']]),
    });

    render(<QuestInlineLink questId="q-77" />);
    fireEvent.mouseEnter(screen.getByText("q-77"));

    expect(mockGetQuestValidated).toHaveBeenCalledWith("q-77", '"detail-v1"');
    expect(screen.queryByTestId("quest-hover-card")).toBeNull();
    resolveFetch({ status: "fresh", data: fresh, etag: '"detail-v2"' });

    await waitFor(() => expect(screen.getByTestId("quest-hover-status-chip").textContent).toContain("Completed"));
    expect(useStore.getState().questDetails.get("q-77")).toBe(fresh);
    expect(useStore.getState().questDetailEtags.get("q-77")).toBe('"detail-v2"');
  });

  it("coalesces duplicate hover revalidations for the same quest and ETag", async () => {
    // Multiple rendered links can point at the same cached quest; only one validator request should be in flight.
    const cached = quest({ questId: "q-88", title: "Shared cached hover", status: "refined" });
    let resolveFetch: (result: Awaited<ReturnType<typeof api.getQuestValidated>>) => void = () => {};
    mockGetQuestValidated.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    useStore.setState({
      questDetails: new Map([["q-88", cached]]),
      questDetailEtags: new Map([["q-88", '"shared-v1"']]),
    });

    render(
      <div>
        <QuestInlineLink questId="q-88">first link</QuestInlineLink>
        <QuestInlineLink questId="q-88">second link</QuestInlineLink>
      </div>,
    );

    fireEvent.mouseEnter(screen.getByText("first link"));
    fireEvent.mouseEnter(screen.getByText("second link"));

    expect(mockGetQuestValidated).toHaveBeenCalledTimes(1);
    expect(mockGetQuestValidated).toHaveBeenCalledWith("q-88", '"shared-v1"');
    resolveFetch({ status: "not-modified", etag: '"shared-v1"' });
    await waitFor(() => expect(screen.getAllByTestId("quest-hover-title")[0]?.textContent).toBe("Shared cached hover"));
  });
});
