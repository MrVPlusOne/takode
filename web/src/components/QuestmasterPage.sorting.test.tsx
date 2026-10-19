// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { QuestmasterTask } from "../types.js";
import {
  buildVerificationQuest,
  renderedQuestIds,
  enterBackendSearch,
  expectLastQuestPageCall,
  hasButtonNamed,
  installQuestmasterPageTestHooks,
  mockGetSettings,
  mockListQuestPage,
  mockState,
  mockUpdateSettings,
  scrollNearQuestmasterBottom,
  settleLatestQuestPageRequest,
} from "./QuestmasterPage.test-harness.js";

vi.mock("../api.js", async () => (await import("./QuestmasterPage.test-harness.js")).mockApiModule());
vi.mock("../utils/questmaster-view-state.js", async () =>
  (await import("./QuestmasterPage.test-harness.js")).mockViewStateModule(),
);
vi.mock("../utils/highlight.js", async () => (await import("./QuestmasterPage.test-harness.js")).mockHighlightModule());
vi.mock("../store.js", async () => (await import("./QuestmasterPage.test-harness.js")).mockStoreModule());

import { QuestmasterPage } from "./QuestmasterPage.js";

installQuestmasterPageTestHooks();

function renderQuestmaster(props: { isActive?: boolean } = {}) {
  return render(<QuestmasterPage isActive={false} {...props} />);
}

describe("QuestmasterPage paging and sorting", () => {
  it("debounces text search before calling the backend page API", async () => {
    // Typing should not issue one backend request per keystroke; the latest
    // search text is sent only after the Questmaster debounce interval.
    vi.useFakeTimers();
    try {
      renderQuestmaster({ isActive: true });
      await act(async () => {
        await Promise.resolve();
      });
      mockListQuestPage.mockClear();

      const searchInput = screen.getByPlaceholderText("Search or #tag...");
      fireEvent.change(searchInput, { target: { value: "q" } });
      await act(async () => {
        vi.advanceTimersByTime(499);
        await Promise.resolve();
      });
      expect(mockListQuestPage).not.toHaveBeenCalled();

      fireEvent.change(searchInput, { target: { value: "q-2" } });
      await act(async () => {
        vi.advanceTimersByTime(499);
        await Promise.resolve();
      });
      expect(mockListQuestPage).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(1);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(mockListQuestPage).toHaveBeenCalledTimes(1);
      expectLastQuestPageCall({ text: "q-2" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("lazily loads later pages while keeping rendered rows bounded", async () => {
    // Loading more can browse past the first backend page, but the mounted list
    // should stay capped so long sessions do not rebuild hundreds of rows.
    mockGetSettings.mockResolvedValueOnce({
      questmasterCompactSort: { column: "quest", direction: "asc" },
    });
    mockState.quests = Array.from({ length: 175 }, (_, index) => {
      const questNumber = index + 1;
      return {
        ...buildVerificationQuest({
          id: `q-${questNumber}-v1`,
          questId: `q-${questNumber}`,
          title: `Generated quest ${String(questNumber).padStart(3, "0")}`,
        }),
        status: "done",
        createdAt: questNumber,
        updatedAt: questNumber,
        verificationInboxUnread: false,
      } as QuestmasterTask;
    });

    renderQuestmaster({ isActive: true });

    await waitFor(() => {
      expectLastQuestPageCall({ offset: 0, limit: 50, sortColumn: "quest", sortDirection: "asc" });
      expect(renderedQuestIds()).toHaveLength(50);
      expect(renderedQuestIds()[0]).toBe("q-1");
    });
    await settleLatestQuestPageRequest();

    expect(hasButtonNamed("Load more")).toBe(false);
    expect(hasButtonNamed("Previous")).toBe(false);

    scrollNearQuestmasterBottom();
    await waitFor(() => {
      expectLastQuestPageCall({ offset: 50, limit: 50 });
      expect(renderedQuestIds()).toHaveLength(100);
      expect(renderedQuestIds()[99]).toBe("q-100");
    });

    scrollNearQuestmasterBottom();
    await waitFor(() => {
      expectLastQuestPageCall({ offset: 100, limit: 50 });
      expect(renderedQuestIds()).toHaveLength(150);
      expect(renderedQuestIds()[149]).toBe("q-150");
    });

    scrollNearQuestmasterBottom();
    await waitFor(() => {
      expectLastQuestPageCall({ offset: 150, limit: 50 });
      expect(renderedQuestIds()).toHaveLength(150);
      expect(renderedQuestIds()[0]).toBe("q-26");
      expect(renderedQuestIds()[149]).toBe("q-175");
      expect(screen.getByTestId("quest-page-bottom-range")).toHaveTextContent("Showing 26-175 of 175");
      expect(screen.getByText("Scroll up to load previous results")).toBeInTheDocument();
    });
  });

  it("orders rows by newest update without grouping by status", async () => {
    // The list is sorted by updated time by default, independent of quest status.
    mockState.quests = [
      {
        ...buildVerificationQuest({ id: "q-20-v1", questId: "q-20", title: "Old verification" }),
        createdAt: 100,
        claimedAt: 100,
        statusChangedAt: 100,
        updatedAt: 1_000,
      } as QuestmasterTask,
      {
        ...buildVerificationQuest({ id: "q-21-v1", questId: "q-21", title: "Newest refined" }),
        status: "refined",
        createdAt: 200,
        statusChangedAt: 200,
        updatedAt: 9_000,
      } as QuestmasterTask,
      {
        ...buildVerificationQuest({ id: "q-22-v1", questId: "q-22", title: "Middle progress" }),
        status: "in_progress",
        createdAt: 300,
        claimedAt: 300,
        statusChangedAt: 300,
        updatedAt: 5_000,
      } as QuestmasterTask,
    ];

    renderQuestmaster({ isActive: true });

    await screen.findByRole("button", { name: /Newest refined/ });
    await waitFor(() => {
      expectLastQuestPageCall({ sortColumn: "updated", sortDirection: "desc" });
      expect(renderedQuestIds()).toEqual(["q-21", "q-22", "q-20"]);
    });
  });

  it("loads the server-persisted sort and applies it after default filtering", async () => {
    // The server-owned sort should hydrate on activation and order the list.
    mockGetSettings.mockResolvedValueOnce({
      questmasterCompactSort: { column: "title", direction: "asc" },
    });
    mockState.quests = [
      {
        ...buildVerificationQuest({ id: "q-40-v1", questId: "q-40", title: "Zulu task" }),
        status: "refined",
        updatedAt: 9_000,
      } as QuestmasterTask,
      {
        ...buildVerificationQuest({ id: "q-41-v1", questId: "q-41", title: "Alpha task" }),
        status: "refined",
        updatedAt: 1_000,
      } as QuestmasterTask,
    ];

    renderQuestmaster({ isActive: true });

    await screen.findByRole("button", { name: /Alpha task/ });
    await waitFor(() => {
      expectLastQuestPageCall({ sortColumn: "title", sortDirection: "asc" });
      expect(renderedQuestIds()).toEqual(["q-41", "q-40"]);
    });
  });

  it("keeps column sorting when search is empty, then ranks non-empty searches by relevance", async () => {
    // Empty search should honor the selected sort, but typing a query
    // should let exact word matches beat title-only prefix matches.
    mockGetSettings.mockResolvedValueOnce({
      questmasterCompactSort: { column: "title", direction: "asc" },
    });
    mockState.quests = [
      {
        ...buildVerificationQuest({
          id: "q-70-v1",
          questId: "q-70",
          title: "Position newly created quest tabs after Main",
        }),
        status: "done",
        description: "Title has prefix-token relevance once search is active.",
        updatedAt: 1_000,
      } as QuestmasterTask,
      {
        ...buildVerificationQuest({
          id: "q-71-v1",
          questId: "q-71",
          title: "Alpha background note",
        }),
        status: "in_progress",
        description: "Mentions new tab only in the description.",
        updatedAt: 9_000,
      } as QuestmasterTask,
    ];

    renderQuestmaster({ isActive: true });
    await screen.findByRole("button", { name: /Alpha background note/ });
    await waitFor(() => {
      expectLastQuestPageCall({ sortColumn: "title", sortDirection: "asc" });
      expect(renderedQuestIds()).toEqual(["q-71", "q-70"]);
    });

    await enterBackendSearch(screen.getByPlaceholderText("Search or #tag..."), "new tab");

    expect(renderedQuestIds()).toEqual(["q-71", "q-70"]);
  });

  it("toggles column headers, persists the choice, and updates row order", async () => {
    // Header buttons should advertise the next direction and save the selected sort server-side.
    mockGetSettings.mockResolvedValueOnce({
      questmasterCompactSort: { column: "updated", direction: "desc" },
    });
    mockState.quests = [
      {
        ...buildVerificationQuest({ id: "q-50-v1", questId: "q-50", title: "Zulu task" }),
        status: "refined",
        updatedAt: 9_000,
      } as QuestmasterTask,
      {
        ...buildVerificationQuest({ id: "q-51-v1", questId: "q-51", title: "Alpha task" }),
        status: "refined",
        updatedAt: 1_000,
      } as QuestmasterTask,
    ];

    renderQuestmaster({ isActive: true });
    await screen.findByRole("button", { name: /Zulu task/ });

    fireEvent.click(screen.getByRole("button", { name: "Sort by Quest ascending" }));

    await waitFor(() => {
      expect(mockUpdateSettings).toHaveBeenCalledWith({
        questmasterCompactSort: { column: "title", direction: "asc" },
      });
      // The re-sorted page arrives after the settings save; wait for it rather
      // than reading the rows of the previous page.
      expect(renderedQuestIds()).toEqual(["q-51", "q-50"]);
    });

    fireEvent.click(screen.getByRole("button", { name: "Sort by Quest descending" }));

    await waitFor(() => {
      expect(mockUpdateSettings).toHaveBeenLastCalledWith({
        questmasterCompactSort: { column: "title", direction: "desc" },
      });
      expect(renderedQuestIds()).toEqual(["q-50", "q-51"]);
    });
  });

  it("filters first, then sorts rows by quest id numeric suffix", async () => {
    mockGetSettings.mockResolvedValueOnce({
      questmasterCompactSort: { column: "quest", direction: "asc" },
    });
    mockState.quests = [
      {
        ...buildVerificationQuest({ id: "q-10-v1", questId: "q-10", title: "Keep later id" }),
        status: "refined",
      } as QuestmasterTask,
      {
        ...buildVerificationQuest({ id: "q-2-v1", questId: "q-2", title: "Keep early id" }),
        status: "refined",
      } as QuestmasterTask,
      {
        ...buildVerificationQuest({ id: "q-1-v1", questId: "q-1", title: "Drop this row" }),
        status: "refined",
      } as QuestmasterTask,
    ];

    renderQuestmaster({ isActive: true });
    await screen.findByRole("button", { name: /Keep early id/ });

    await enterBackendSearch(screen.getByPlaceholderText("Search or #tag..."), "Keep");

    expect(renderedQuestIds()).toEqual(["q-2", "q-10"]);
    expect(screen.queryByRole("button", { name: /Drop this row/ })).toBeNull();
  });

  it("ranks search results by relevance instead of the saved sort", async () => {
    // Search should put the best match first, so an exact description match
    // beats a title-only prefix match.
    mockGetSettings.mockResolvedValueOnce({
      questmasterCompactSort: { column: "updated", direction: "desc" },
    });
    mockState.quests = [
      {
        ...buildVerificationQuest({
          id: "q-80-v1",
          questId: "q-80",
          title: "Position newly created quest tabs after Main",
        }),
        status: "done",
        description: "Older card with title prefix relevance.",
        updatedAt: 1_000,
      } as QuestmasterTask,
      {
        ...buildVerificationQuest({
          id: "q-81-v1",
          questId: "q-81",
          title: "Active implementation note",
        }),
        status: "in_progress",
        description: "Weaker new tab mention in body text.",
        updatedAt: 9_000,
      } as QuestmasterTask,
    ];

    renderQuestmaster({ isActive: true });
    await screen.findByText("Active implementation note");

    await enterBackendSearch(screen.getByPlaceholderText("Search or #tag..."), "new tab");

    expect(
      Array.from(document.querySelectorAll<HTMLElement>("[data-quest-id]")).map((el) => el.dataset.questId),
    ).toEqual(["q-81", "q-80"]);
  });

  it("applies the status chip filter to the list", async () => {
    mockState.quests = [
      { ...buildVerificationQuest({ id: "q-30-v1", questId: "q-30", title: "Verification row" }) } as QuestmasterTask,
      {
        ...buildVerificationQuest({ id: "q-31-v1", questId: "q-31", title: "Refined row" }),
        status: "refined",
      } as QuestmasterTask,
    ];

    renderQuestmaster({ isActive: true });
    await screen.findByRole("button", { name: /Verification row/ });

    fireEvent.click(screen.getByRole("button", { name: /^Actionable\s*1$/ }));

    await waitFor(() => {
      expectLastQuestPageCall({ status: "refined" });
      expect(screen.queryByRole("button", { name: /Verification row/ })).toBeNull();
      expect(screen.getByRole("button", { name: /Refined row/ })).toBeInTheDocument();
    });
  });
});
