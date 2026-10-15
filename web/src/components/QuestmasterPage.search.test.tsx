// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { QuestmasterTask } from "../types.js";
import {
  buildVerificationQuest,
  enterBackendSearch,
  expectLastQuestPageCall,
  installQuestmasterPageTestHooks,
  mockState,
} from "./QuestmasterPage.test-harness.js";

vi.mock("../api.js", async () => (await import("./QuestmasterPage.test-harness.js")).mockApiModule());
vi.mock("../utils/questmaster-view-state.js", async (importOriginal) =>
  (await import("./QuestmasterPage.test-harness.js")).mockViewStateModule(await importOriginal()),
);
vi.mock("../utils/highlight.js", async () => (await import("./QuestmasterPage.test-harness.js")).mockHighlightModule());
vi.mock("../store.js", async () => (await import("./QuestmasterPage.test-harness.js")).mockStoreModule());

import { QuestmasterPage } from "./QuestmasterPage.js";

installQuestmasterPageTestHooks();

function renderQuestmaster(props: { isActive?: boolean } = {}) {
  return render(<QuestmasterPage isActive={false} {...props} />);
}

describe("QuestmasterPage search and tag filters", () => {
  it("filters quests by quest id from the search box", async () => {
    // Questmaster search should support direct quest-id lookup so users can
    // jump to a known quest like q-2 without remembering the title text.
    renderQuestmaster({ isActive: true });

    const searchInput = screen.getByPlaceholderText("Search or #tag...");

    await enterBackendSearch(searchInput, "q-2");
    expect(screen.getByText("Regular verification quest")).toBeInTheDocument();
    expect(screen.queryByText("Fresh verification quest")).toBeNull();

    await enterBackendSearch(searchInput, "Q-1");
    expect(screen.getByText("Fresh verification quest")).toBeInTheDocument();
    expect(screen.queryByText("Regular verification quest")).toBeNull();
  });

  it("filters by TLDR and full feedback text when feedback has TLDR metadata", async () => {
    // TLDR should improve visible scan text without making the detailed body unsearchable.
    mockState.quests = [
      {
        ...buildVerificationQuest({ id: "q-30-v1", questId: "q-30", title: "TLDR quest" }),
        tldr: "Short scanline",
        feedback: [{ author: "agent", text: "Full implementation detail", tldr: "Short handoff", ts: Date.now() }],
      } as QuestmasterTask,
      {
        ...buildVerificationQuest({ id: "q-31-v1", questId: "q-31", title: "Other quest" }),
        verificationInboxUnread: false,
      } as QuestmasterTask,
    ];

    renderQuestmaster({ isActive: true });

    const searchInput = screen.getByPlaceholderText("Search or #tag...");
    await enterBackendSearch(searchInput, "scanline");
    expect(document.querySelector('[data-quest-id="q-30"]')).toBeTruthy();
    expect(document.querySelector('[data-quest-id="q-31"]')).toBeNull();

    await enterBackendSearch(searchInput, "implementation");
    expect(document.querySelector('[data-quest-id="q-30"]')).toBeTruthy();
    expect(document.querySelector('[data-quest-id="q-31"]')).toBeNull();
  });

  it("shows phase TLDR scan lines in quest list results", () => {
    mockState.quests = [
      {
        ...buildVerificationQuest({ id: "q-40-v1", questId: "q-40", title: "Phase documented quest" }),
        journeyRuns: [
          {
            runId: "run-1",
            source: "board",
            phaseIds: ["alignment", "implement"],
            status: "completed",
            createdAt: 1,
            updatedAt: 2,
            phaseOccurrences: [
              {
                occurrenceId: "run-1:p1",
                phaseId: "alignment",
                phaseIndex: 0,
                phasePosition: 1,
                phaseOccurrence: 1,
                status: "completed",
              },
              {
                occurrenceId: "run-1:p2",
                phaseId: "implement",
                phaseIndex: 1,
                phasePosition: 2,
                phaseOccurrence: 1,
                status: "completed",
              },
            ],
          },
        ],
        feedback: [
          {
            author: "agent",
            text: "Full implementation detail should stay out of the compact list.",
            tldr: "Implementation phase scanline.",
            ts: Date.now(),
            journeyRunId: "run-1",
            phaseOccurrenceId: "run-1:p2",
            phaseId: "implement",
            phasePosition: 2,
          },
        ],
      } as QuestmasterTask,
    ];

    renderQuestmaster({ isActive: true });

    expect(screen.getByText(/Implement phase 2:/)).toBeInTheDocument();
    expect(screen.getByText(/Implementation phase scanline/)).toBeInTheDocument();
    expect(screen.queryByText(/Full implementation detail should stay out/)).toBeNull();
  });

  it("preserves plain-text title search while ignoring negated-tag syntax", async () => {
    // q-331: plain-text matching should remain intact after introducing
    // explicit `-#tag` exclusion parsing.
    mockState.quests = [
      {
        ...buildVerificationQuest({ id: "q-40-v1", questId: "q-40", title: "Auth mobile quest" }),
        verificationInboxUnread: false,
        tags: ["auth", "mobile"],
      } as QuestmasterTask,
      {
        ...buildVerificationQuest({ id: "q-41-v1", questId: "q-41", title: "Infra backend quest" }),
        verificationInboxUnread: false,
        tags: ["infra", "backend"],
      } as QuestmasterTask,
    ];

    renderQuestmaster({ isActive: true });

    const searchInput = screen.getByPlaceholderText("Search or #tag...");
    await enterBackendSearch(searchInput, "backend");

    expect(document.querySelector('[data-quest-id="q-41"]')).toBeTruthy();
    expect(document.querySelector('[data-quest-id="q-40"]')).toBeNull();
  });

  it("preserves positive #tag search through the existing autocomplete tag-pill flow", async () => {
    // Positive #tag search should keep working exactly as before: selecting an
    // autocomplete tag turns it into a pill and filters by matching quests.
    mockState.quests = [
      {
        ...buildVerificationQuest({ id: "q-50-v1", questId: "q-50", title: "Auth mobile quest" }),
        verificationInboxUnread: false,
        tags: ["auth", "mobile"],
      } as QuestmasterTask,
      {
        ...buildVerificationQuest({ id: "q-51-v1", questId: "q-51", title: "Auth backend quest" }),
        verificationInboxUnread: false,
        tags: ["auth", "backend"],
      } as QuestmasterTask,
      {
        ...buildVerificationQuest({ id: "q-52-v1", questId: "q-52", title: "Infra mobile quest" }),
        verificationInboxUnread: false,
        tags: ["infra", "mobile"],
      } as QuestmasterTask,
    ];

    renderQuestmaster({ isActive: true });

    const searchInput = screen.getByPlaceholderText("Search or #tag...");
    fireEvent.change(searchInput, { target: { value: "#mob" } });
    fireEvent.keyDown(searchInput, { key: "Enter" });

    expect(screen.getByText("#mobile")).toBeInTheDocument();
    await waitFor(() => {
      expectLastQuestPageCall({ tags: ["mobile"] });
      expect(screen.getByText("Auth mobile quest")).toBeInTheDocument();
      expect(screen.getByText("Infra mobile quest")).toBeInTheDocument();
      expect(screen.queryByText("Auth backend quest")).toBeNull();
    });
  });

  it("supports bare # as the positive-tag autocomplete entry path", () => {
    // q-331 follow-up: typing a bare `#` should still open the positive-tag
    // suggestions so users can enter the existing #tag pill flow without
    // typing a tag prefix first.
    mockState.quests = [
      {
        ...buildVerificationQuest({ id: "q-55-v1", questId: "q-55", title: "Alpha quest" }),
        verificationInboxUnread: false,
        tags: ["alpha"],
      } as QuestmasterTask,
      {
        ...buildVerificationQuest({ id: "q-56-v1", questId: "q-56", title: "Beta quest" }),
        verificationInboxUnread: false,
        tags: ["beta"],
      } as QuestmasterTask,
    ];

    renderQuestmaster({ isActive: true });

    const searchInput = screen.getByPlaceholderText("Search or #tag...") as HTMLInputElement;
    fireEvent.focus(searchInput);
    fireEvent.change(searchInput, { target: { value: "#" } });
    fireEvent.keyDown(searchInput, { key: "Enter" });

    expect(screen.getByText("#alpha")).toBeInTheDocument();
    expect(searchInput.value).toBe("");
  });

  it("shows an excluding hint and keeps negated autocomplete in the raw query", () => {
    // The clearer negated syntax uses `!#tag`. While typing it, the dropdown
    // should hint that the user is excluding a tag and selecting an option
    // should keep that negated token in the raw query instead of creating a
    // positive tag pill.
    mockState.quests = [
      {
        ...buildVerificationQuest({ id: "q-57-v1", questId: "q-57", title: "Alpha quest" }),
        verificationInboxUnread: false,
        tags: ["alpha"],
      } as QuestmasterTask,
      {
        ...buildVerificationQuest({ id: "q-58-v1", questId: "q-58", title: "Beta quest" }),
        verificationInboxUnread: false,
        tags: ["beta"],
      } as QuestmasterTask,
    ];

    renderQuestmaster({ isActive: true });

    const searchInput = screen.getByPlaceholderText("Search or #tag...") as HTMLInputElement;
    fireEvent.focus(searchInput);
    fireEvent.change(searchInput, { target: { value: "!#" } });

    expect(screen.getByText("excluding:")).toBeInTheDocument();
    fireEvent.keyDown(searchInput, { key: "Enter" });

    expect(searchInput.value).toBe("!#alpha");
    expect(screen.queryByText("#alpha")).toBeNull();
  });

  it("supports -#tag to exclude quests with matching tags", async () => {
    // q-331: the search box should support explicit negated tags that exclude
    // matching quests without requiring users to mutate the positive tag pills.
    mockState.quests = [
      {
        ...buildVerificationQuest({ id: "q-60-v1", questId: "q-60", title: "Auth mobile quest" }),
        verificationInboxUnread: false,
        tags: ["auth", "mobile"],
      } as QuestmasterTask,
      {
        ...buildVerificationQuest({ id: "q-61-v1", questId: "q-61", title: "Auth backend quest" }),
        verificationInboxUnread: false,
        tags: ["auth", "backend"],
      } as QuestmasterTask,
      {
        ...buildVerificationQuest({ id: "q-62-v1", questId: "q-62", title: "Infra mobile quest" }),
        verificationInboxUnread: false,
        tags: ["infra", "mobile"],
      } as QuestmasterTask,
    ];

    renderQuestmaster({ isActive: true });

    const searchInput = screen.getByPlaceholderText("Search or #tag...");
    fireEvent.change(searchInput, { target: { value: "!#mobile" } });
    await waitFor(() => {
      expectLastQuestPageCall({ excludeTags: ["mobile"] });
    });

    expect(document.querySelector('[data-quest-id="q-61"]')).toBeTruthy();
    expect(document.querySelector('[data-quest-id="q-60"]')).toBeNull();
    expect(document.querySelector('[data-quest-id="q-62"]')).toBeNull();
  });

  it("does not convert negated hashtags into positive tag pills via autocomplete", () => {
    // Negated tags should stay in the raw search query. Hitting Enter on `!#mob`
    // must not create the positive `#mobile` tag pill or clear the search text.
    mockState.quests = [
      {
        ...buildVerificationQuest({ id: "q-65-v1", questId: "q-65", title: "Auth mobile quest" }),
        verificationInboxUnread: false,
        tags: ["auth", "mobile"],
      } as QuestmasterTask,
      {
        ...buildVerificationQuest({ id: "q-66-v1", questId: "q-66", title: "Infra backend quest" }),
        verificationInboxUnread: false,
        tags: ["infra", "backend"],
      } as QuestmasterTask,
    ];

    renderQuestmaster();

    const searchInput = screen.getByPlaceholderText("Search or #tag...") as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: "!#mob" } });
    fireEvent.keyDown(searchInput, { key: "Enter" });

    expect(searchInput.value).toBe("!#mobile");
    expect(screen.queryByText("#mobile")).toBeNull();
  });

  it("treats numeric-leading hashtag tokens as plain text search", async () => {
    // Session-style references like #123 should remain searchable literal text
    // instead of being stripped as tag syntax or turned into tag autocomplete.
    mockState.quests = [
      {
        ...buildVerificationQuest({ id: "q-67-v1", questId: "q-67", title: "Follow up on #123 reconnect report" }),
        verificationInboxUnread: false,
        tags: ["alpha"],
      } as QuestmasterTask,
      {
        ...buildVerificationQuest({ id: "q-68-v1", questId: "q-68", title: "Follow up on #456 reconnect report" }),
        verificationInboxUnread: false,
        tags: ["alpha"],
      } as QuestmasterTask,
    ];

    renderQuestmaster({ isActive: true });

    const searchInput = screen.getByPlaceholderText("Search or #tag...");
    await enterBackendSearch(searchInput, "#123");

    expect(document.querySelector('[data-quest-id="q-67"]')).toBeTruthy();
    expect(document.querySelector('[data-quest-id="q-68"]')).toBeNull();
    expect(screen.queryByText("excluding:")).toBeNull();
  });

  it("supports mixed free-text plus negated-tag queries and only highlights the positive text", async () => {
    // Mixed queries like `auth !#mobile` should preserve the positive text
    // match while excluding the negated tag, and highlight only the positive
    // free-text portion of the query.
    mockState.quests = [
      {
        ...buildVerificationQuest({ id: "q-70-v1", questId: "q-70", title: "Auth mobile quest" }),
        verificationInboxUnread: false,
        tags: ["auth", "mobile"],
      } as QuestmasterTask,
      {
        ...buildVerificationQuest({ id: "q-71-v1", questId: "q-71", title: "Auth backend quest" }),
        verificationInboxUnread: false,
        tags: ["auth", "backend"],
      } as QuestmasterTask,
      {
        ...buildVerificationQuest({ id: "q-72-v1", questId: "q-72", title: "Infra backend quest" }),
        verificationInboxUnread: false,
        tags: ["infra", "backend"],
      } as QuestmasterTask,
    ];

    const { container } = renderQuestmaster({ isActive: true });

    const searchInput = screen.getByPlaceholderText("Search or #tag...");
    await enterBackendSearch(searchInput, "auth !#mobile", "auth");

    expect(document.querySelector('[data-quest-id="q-71"]')).toBeTruthy();
    expect(document.querySelector('[data-quest-id="q-70"]')).toBeNull();
    expect(document.querySelector('[data-quest-id="q-72"]')).toBeNull();

    const marks = Array.from(container.querySelectorAll("mark")).map((el) => el.textContent?.toLowerCase());
    expect(marks).toContain("auth");
    expect(marks).not.toContain("mobile");
  });

  it("supports mixed positive #tag pills plus negated-tag queries", async () => {
    // Users should be able to select a positive tag via the existing pill flow
    // and then further narrow the result with a raw `!#tag` exclusion query.
    mockState.quests = [
      {
        ...buildVerificationQuest({ id: "q-80-v1", questId: "q-80", title: "Auth mobile quest" }),
        verificationInboxUnread: false,
        tags: ["auth", "mobile"],
      } as QuestmasterTask,
      {
        ...buildVerificationQuest({ id: "q-81-v1", questId: "q-81", title: "Auth backend quest" }),
        verificationInboxUnread: false,
        tags: ["auth", "backend"],
      } as QuestmasterTask,
      {
        ...buildVerificationQuest({ id: "q-82-v1", questId: "q-82", title: "Infra mobile quest" }),
        verificationInboxUnread: false,
        tags: ["infra", "mobile"],
      } as QuestmasterTask,
    ];

    renderQuestmaster({ isActive: true });

    const searchInput = screen.getByPlaceholderText("Search or #tag...");
    fireEvent.change(searchInput, { target: { value: "#auth" } });
    fireEvent.keyDown(searchInput, { key: "Enter" });
    expect(screen.getByText("#auth")).toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: "!#backend" } });

    await waitFor(() => {
      expectLastQuestPageCall({ tags: ["auth"], excludeTags: ["backend"] });
      expect(document.querySelector('[data-quest-id="q-80"]')).toBeTruthy();
      expect(document.querySelector('[data-quest-id="q-81"]')).toBeNull();
      expect(document.querySelector('[data-quest-id="q-82"]')).toBeNull();
    });
  });

  it("passes only the positive/free-text portion of a mixed negated query into the quest overlay", () => {
    // The detail overlay highlight should reuse the parsed positive search text,
    // not the raw query with `!#tag` suffixes.
    mockState.quests = [
      {
        ...buildVerificationQuest({ id: "q-90-v1", questId: "q-90", title: "Auth mobile quest" }),
        verificationInboxUnread: false,
        tags: ["auth", "mobile"],
      } as QuestmasterTask,
      {
        ...buildVerificationQuest({ id: "q-91-v1", questId: "q-91", title: "Auth backend quest" }),
        verificationInboxUnread: false,
        tags: ["auth", "backend"],
      } as QuestmasterTask,
    ];

    renderQuestmaster();

    const searchInput = screen.getByPlaceholderText("Search or #tag...");
    fireEvent.change(searchInput, { target: { value: "auth !#mobile" } });

    const cardButton = document.querySelector('[data-quest-id="q-91"] [role="button"]') as HTMLElement | null;
    expect(cardButton).toBeTruthy();
    fireEvent.click(cardButton!);

    expect(mockState.openQuestOverlay).toHaveBeenCalledWith("q-91", "auth");
  });
});
