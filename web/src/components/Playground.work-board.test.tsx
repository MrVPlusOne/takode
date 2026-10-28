// @vitest-environment jsdom

import { closeAllThreadTabs, listedThreadTab, listedThreadTabs } from "../test-fixtures/thread-tab-rows.js";
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";

// Mock markdown renderer used by MessageBubble/PermissionBanner

vi.mock("./ViewportHandoffEntryGate.js", () => ({
  ViewportHandoffThreadEntryGate: ({ children }: any) => children,
  ViewportHandoffSessionEntryGate: ({ children }: any) => children,
}));

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}));
vi.mock("remark-gfm", () => ({
  default: {},
}));

import { Playground } from "./Playground.js";
import { getPlaygroundSection, installPlaygroundTestEnvironment } from "./Playground.test-helpers.js";

// Playground tests are split across Playground*.test.tsx files so the heavy full-catalog
// renders run in parallel workers. This file: Work Board Bar, Journey and quest-thread Playground fixtures.
installPlaygroundTestEnvironment();

// A full-catalog render costs about 4-8 s of CPU on its own, so several concurrent
// suite runs need more than the default 10 s (some took 30-45 s with two full runs at
// once on the DevBox); tests with larger needs set their own.
describe("Playground", { timeout: 60_000 }, () => {
  it("documents that Main shows neither the resolved reminder nor the quest thread's answered prompt", () => {
    render(<Playground />);

    // The fixture prompt belongs to a quest thread, so once answered it has no Main row.
    const mainProjection = screen.getByTestId("playground-resolved-reminder-main-projection");
    expect(within(mainProjection).queryByText("Historical needs-input reminder")).toBeNull();
    expect(within(mainProjection).queryByTestId("attention-ledger-row")).toBeNull();
    expect(within(mainProjection).queryByText("Choose the retained implementation scope")).toBeNull();
  });

  it("documents Journey lifecycle rows as audit-only while banners retain status", () => {
    render(<Playground />);

    const ledger = screen.getByTestId("playground-attention-ledger-records");
    expect(within(ledger).getByTestId("playground-lifecycle-feed-policy")).toHaveTextContent(
      "retained for audit but intentionally omitted from ordinary feeds",
    );
    expect(within(ledger).queryByText("Journey started")).toBeNull();
    expect(within(ledger).queryByText("Journey finished")).toBeNull();
    expect(
      within(ledger)
        .getAllByTestId("attention-ledger-row")
        .some((row) => ["quest_journey_started", "quest_completed_recent"].includes(row.dataset.attentionType ?? "")),
    ).toBe(false);
    const banner = screen.getAllByTestId("quest-thread-banner")[0];
    expect(within(banner).getByTestId("quest-journey-compact-summary")).toHaveTextContent("Work2/3");
    expect(within(banner).getByTestId("quest-journey-compact-summary")).toHaveClass("rounded-full", "border");
  });

  it("documents Work Board Bar status groups, the phase legend and tab states", () => {
    render(<Playground />);

    const workBoardBar = getPlaygroundSection("interactive-work-board-bar");
    fireEvent.click(workBoardBar.getByText("Seed board data"));

    const rail = workBoardBar.getByTestId("thread-tab-rail");
    expect(within(rail).getByTestId("thread-tab-group-bar")).toBeTruthy();
    expect(within(rail).queryByText("Tabs")).not.toBeInTheDocument();
    expect(workBoardBar.getByTestId("workboard-main-banner")).toBeTruthy();
    expect(
      rail.compareDocumentPosition(workBoardBar.getByTestId("workboard-main-banner")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(workBoardBar.getByTestId("workboard-active-button")).toBeInTheDocument();
    expect(workBoardBar.queryByTestId("workboard-current-thread")).toBeNull();
    expect(workBoardBar.getByTestId("workboard-phase-summary")).toHaveTextContent("1 Work");

    // Main is the selected tab, joined to the Main strip, and the leader is not writing in Main.
    const mainTab = workBoardBar.getByTestId("thread-tab-group-main");
    expect(mainTab).toHaveAttribute("aria-selected", "true");
    expect(mainTab).toHaveClass("border-cc-primary/45", "bg-cc-card", "text-cc-fg");
    expect(mainTab).toHaveAttribute("data-active-output", "false");

    // Every seeded tab is listed under its group, with canonical titles.
    const container = rail;
    const tab = (threadKey: string) => listedThreadTab(threadKey, container)!;
    for (const key of ["q-1932", "q-42", "q-55", "q-61", "q-77", "q-88"]) expect(tab(key)).toBeTruthy();
    expect(tab("q-1932")).toHaveTextContent("Resolve VSCode QA Stack Conflicts");

    // q-42 is active work the leader is writing in: not closable, with the writing marker.
    expect(tab("q-42")).toHaveAttribute("data-closable", "false");
    expect(within(tab("q-42")).queryByTestId("thread-tab-list-row-close")).not.toBeInTheDocument();
    expect(tab("q-42")).toHaveAttribute("data-active-output", "true");
    expect(within(tab("q-42")).getByTestId("thread-tab-active-output-spinner")).toBeTruthy();
    expect(within(tab("q-42")).getByTestId("thread-tab-bell")).toHaveAttribute("data-kind", "needs-input");

    // The queued q-55 reads in the normal foreground; the finished q-88 stays in Thread
    // Waiting, so it shows the normal-foreground override instead of the done gray.
    expect(tab("q-55")).toHaveAttribute("data-active-output", "false");
    expect(tab("q-55")).toHaveAttribute("data-title-color", "var(--color-cc-fg)");
    expect(tab("q-88")).toHaveAttribute("data-title-color", "var(--color-cc-fg)");
    expect(tab("q-88")).toHaveTextContent("Reviewed collapsed-result handling");
    closeAllThreadTabs();

    fireEvent.click(workBoardBar.getByRole("button", { name: "Quest thread" }));
    expect(tab("q-42")).toHaveAttribute("data-selected", "true");
    expect(tab("q-42")).toHaveAttribute("data-active-output", "true");
    closeAllThreadTabs();

    fireEvent.click(workBoardBar.getByText("Simulate moved-message tab"));
    expect(tab("q-99")).toBeTruthy();
    closeAllThreadTabs();
    expect(workBoardBar.queryByTestId("workboard-main-banner")).toBeNull();
    expect(workBoardBar.getByTestId("thread-tab-rail")).toBeTruthy();

    fireEvent.click(workBoardBar.getByText("Main banner"));
    expect(workBoardBar.getByTestId("workboard-projection-main")).toHaveAttribute("aria-pressed", "true");
    expect(workBoardBar.getByTestId("workboard-projection-all")).toHaveAttribute("aria-pressed", "false");
    expect(workBoardBar.getByTestId("workboard-other-button")).toHaveTextContent("3 other");
    expect(workBoardBar.queryByTestId("workboard-off-board-threads")).toBeNull();
    fireEvent.click(workBoardBar.getByTestId("workboard-other-button"));
    expect(workBoardBar.getByTestId("workboard-other-threads-content")).toHaveTextContent(
      "Off-board routed discussion",
    );
  });

  it("documents an unselected completed Waiting tab with normal foreground text", () => {
    // The dedicated control makes the completed-plus-Waiting state visible in
    // the real Playground component while Main remains selected as a contrast.
    render(<Playground />);

    const workBoardBar = getPlaygroundSection("interactive-work-board-bar");
    fireEvent.click(workBoardBar.getByText("Seed board data"));
    fireEvent.click(workBoardBar.getByText("Show waiting completed tab"));

    const waitingTab = listedThreadTab("q-88", workBoardBar.getByTestId("thread-tab-rail"))!;
    expect(waitingTab).toHaveAttribute("data-selected", "false");
    expect(waitingTab).toHaveAttribute("data-title-color", "var(--color-cc-fg)");
    expect(within(waitingTab).queryByTestId("thread-tab-bell")).toBeNull();
    expect(within(waitingTab).queryByTestId("thread-tab-active-output-spinner")).toBeNull();
  });

  it("documents the approved active v2 phase palette with separate readable text and accent tokens", () => {
    // Keep a browser-ready fixture for all active phase colors, including the
    // checkpoint amber that is normally represented as a pause inside Work.
    render(<Playground />);

    const palette = screen.getByTestId("playground-v2-phase-palette");
    const expected = [
      { id: "work", name: "work", text: "#166534", accent: "#4ade80" },
      { id: "user-checkpoint", name: "amber", text: "#8a4b00", accent: "#fbbf24" },
      { id: "memory", name: "memory", text: "#6d28d9", accent: "#8b5cf6" },
      { id: "landing", name: "landing", text: "#0f766e", accent: "#2dd4bf" },
    ];

    for (const phase of expected) {
      const card = within(palette).getByTestId(`playground-v2-phase-${phase.id}`);
      expect(card).toHaveAttribute("data-phase-color", phase.name);
      expect(within(card).getByTestId(`playground-v2-phase-${phase.id}-text`)).toHaveAttribute(
        "style",
        `color: var(--color-cc-phase-${phase.name}, ${phase.text});`,
      );
      expect(within(card).getByTestId(`playground-v2-phase-${phase.id}-accent`).getAttribute("style") ?? "").toContain(
        `var(--color-cc-phase-${phase.name}, ${phase.accent})`,
      );
      expect(within(card).getByTestId("quest-journey-compact-summary")).toHaveTextContent(
        within(card).getByTestId(`playground-v2-phase-${phase.id}-text`).textContent ?? "",
      );
    }
    // An existing approval remains visible while the active phase library starts at Work.
    expect(within(palette).queryByTestId("playground-v2-phase-alignment")).toBeNull();
    expect(within(palette).getByTestId("playground-retained-alignment")).toHaveTextContent("Alignment approval");
  });

  it("documents a desktop tab crowd filed into status groups", () => {
    // Many open tabs no longer overflow into a More list: every one is listed under its group.
    render(<Playground />);

    const workBoardBar = getPlaygroundSection("interactive-work-board-bar");
    fireEvent.click(workBoardBar.getByText("Seed board data"));
    fireEvent.click(workBoardBar.getByText("Simulate desktop tab crowd"));

    const rail = workBoardBar.getByTestId("thread-tab-rail");
    const listed = listedThreadTabs(rail).map((tab) => tab.getAttribute("data-thread-key"));
    for (const key of ["q-42", "q-1101", "q-1104", "q-1108", "q-1112"]) expect(listed).toContain(key);
    expect(listed.length).toBeGreaterThanOrEqual(17);
    closeAllThreadTabs();
  });

  it("documents compact quest-thread banners without chip note counts and with tap previews", () => {
    render(<Playground />);

    expect(screen.getAllByText(/long Quest Journey preview clamped around the current phase/).length).toBeGreaterThan(
      0,
    );

    const banner = screen.getAllByTestId("quest-thread-banner")[0];
    expect(banner).toHaveClass("py-1");
    expect(within(banner).getByTestId("quest-thread-meta-strip")).toHaveClass("flex-[1_1_auto]");
    // A quest thread's strip is one line: Worker and commits are in the phase pill's card.
    expect(within(banner).queryByTestId("quest-thread-participant-strip")).toBeNull();
    expect(within(banner).getByTestId("quest-journey-compact-summary")).toHaveTextContent("Work");
    expect(within(banner).getByTestId("quest-journey-compact-summary")).not.toHaveTextContent("note");
    expect(within(banner).queryByLabelText("Worker #1321 Clear Mesa")).toBeNull();
    const mobileParticipantPreview = screen.getByTestId("playground-mobile-participant-labels");
    const mobileParticipantBanners = within(mobileParticipantPreview).getAllByTestId("quest-thread-banner");
    fireEvent.click(within(mobileParticipantBanners[0]).getByTestId("quest-thread-journey-hover-target"));
    const mobileCard = screen.getAllByTestId("quest-thread-journey-hover-card").at(-1)!;
    expect(within(mobileCard).getByText("Worker")).toHaveClass("max-[319px]:hidden");
    expect(within(mobileCard).getByTestId("session-role-icon-worker")).toBeInTheDocument();
    expect(within(mobileParticipantBanners[1]).getByText("Leader")).toHaveClass("max-[319px]:hidden");
    expect(within(mobileParticipantBanners[1]).getByTestId("session-role-icon-leader")).toBeInTheDocument();
    // Styling matches across roles, while the links retain their distinct identities and navigation destinations.
    const workerLink = within(mobileCard).getByRole("link", { name: /^Worker #/ });
    const leaderLink = within(mobileParticipantBanners[1]).getByRole("link", { name: /^Leader #/ });
    expect(leaderLink.className).toBe(workerLink.className);
    expect(leaderLink).not.toHaveClass("rounded-full", "border");
    expect(leaderLink.getAttribute("href")).not.toBe(workerLink.getAttribute("href"));

    const queuedBanner = screen.getAllByTestId("quest-thread-banner")[1];
    // The checkpoint specimen keeps the phase visible while suppressing duplicate attention.
    const checkpointBanner = screen.getAllByTestId("quest-thread-banner")[4];
    expect(within(checkpointBanner).getByTestId("quest-journey-compact-summary")).toHaveTextContent(
      "User Checkpoint3/5",
    );
    expect(within(checkpointBanner).queryByTestId("quest-thread-wait-pill")).toBeNull();
    expect(within(queuedBanner).getByTestId("quest-thread-queued-status-chip")).toHaveTextContent(
      "Queued, waiting for #1801, q-1367, free worker",
    );
    expect(within(queuedBanner).queryByTestId("quest-thread-wait-pill")).not.toBeInTheDocument();
    // Mobile keeps Journey on the first row; queued dependencies remain available below it.
    expect(within(queuedBanner).getByTestId("quest-journey-compact-summary")).toHaveTextContent("Journey");
    const staleQueuedDoneBanner = screen.getAllByTestId("quest-thread-banner")[2];
    expect(within(staleQueuedDoneBanner).queryByTestId("quest-thread-queued-status-chip")).not.toBeInTheDocument();
    expect(staleQueuedDoneBanner).not.toHaveTextContent("Queued, waiting for free worker");
    expect(within(staleQueuedDoneBanner).getByTestId("quest-journey-compact-summary")).toHaveTextContent("Done");

    fireEvent.click(within(banner).getByTestId("quest-thread-journey-hover-target"));
    const hoverCard = screen.getAllByTestId("quest-thread-journey-hover-card").at(-1)!;
    expect(hoverCard).toBeTruthy();
    expect(within(hoverCard).getByLabelText("Worker #1321 Clear Mesa")).toBeTruthy();
    expect(within(hoverCard).queryByLabelText("Reviewer #1306 Review Lead")).toBeNull();
    expect(within(hoverCard).getByTestId("quest-thread-diff-chip-commits")).toHaveTextContent("2 commits");
    const preview = within(hoverCard).getByTestId("quest-journey-preview-card");
    expect(preview).toHaveTextContent("3 phases · Total 4m");
    expect(
      within(preview)
        .getAllByTestId("quest-journey-phase-duration")
        .map((node) => node.textContent),
    ).toEqual(["1m", "3m"]);
    expect(preview).not.toHaveTextContent("Duration unavailable");
    expect(preview).toHaveTextContent("Work owns implementation, validation, and sync evidence.");

    const completedBanner = screen.getAllByTestId("quest-thread-banner")[3];
    fireEvent.click(within(completedBanner).getByTestId("quest-thread-journey-hover-target"));
    const completedPreview = within(screen.getAllByTestId("quest-thread-journey-hover-card").at(-1)!).getByTestId(
      "quest-journey-preview-card",
    );
    expect(completedPreview).toHaveTextContent("3 phases · Partial 3m");
    expect(
      within(completedPreview)
        .getAllByTestId("quest-journey-phase-duration")
        .map((node) => node.textContent),
    ).toEqual(["1m", "2m"]);
  });
});
