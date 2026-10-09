// @vitest-environment jsdom

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
import {
  getPlaygroundSection,
  installPlaygroundTestEnvironment,
  setMeasuredRailWidth,
} from "./Playground.test-helpers.js";

// Playground tests are split across Playground*.test.tsx files so the heavy full-catalog
// renders run in parallel workers. This file: Work Board Bar, Journey and quest-thread Playground fixtures.
installPlaygroundTestEnvironment();

// A full-catalog render costs about 4-8 s of CPU on its own, so several concurrent
// suite runs need more than the default 10 s; tests with larger needs set their own.
describe("Playground", { timeout: 30_000 }, () => {
  it("documents resolved reminder suppression while retaining the needs-input card in Main", () => {
    render(<Playground />);

    const mainProjection = screen.getByTestId("playground-resolved-reminder-main-projection");
    expect(within(mainProjection).queryByText("Historical needs-input reminder")).toBeNull();
    const decisionCard = within(mainProjection).getByTestId("attention-ledger-row");
    expect(decisionCard).toHaveAttribute("data-attention-type", "needs_input");
    expect(decisionCard).toHaveTextContent("Choose the retained implementation scope");
    expect(within(decisionCard).getByRole("button", { name: "Answer" })).toBeTruthy();
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

  it("documents Work Board Bar tab shrinking, phase legend, and shared quest hover states", async () => {
    setMeasuredRailWidth(392);
    render(<Playground />);

    const workBoardBar = getPlaygroundSection("interactive-work-board-bar");
    fireEvent.click(workBoardBar.getByText("Seed board data"));

    const rail = workBoardBar.getByTestId("thread-tab-rail");
    expect(rail).toHaveAttribute("data-overflow", "more-tabs-list");
    expect(within(rail).queryByText("Tabs")).not.toBeInTheDocument();
    const tabStrip = workBoardBar.getByTestId("thread-tab-strip");
    expect(tabStrip).toHaveAttribute("data-overflow-mode", "more-tabs");
    expect(tabStrip.getAttribute("style") ?? "").toContain("--thread-tab-width: 76px");
    expect(tabStrip).toHaveClass("overflow-visible");
    const moreButton = workBoardBar.getByTestId("thread-tabs-more-button");
    expect(moreButton).toHaveAttribute("data-hidden-count", "3");
    expect(workBoardBar.getByText("Resolve VSCode QA Stack Conflicts")).toBeInTheDocument();
    expect(workBoardBar.getByTestId("workboard-main-banner")).toBeTruthy();
    expect(
      rail.compareDocumentPosition(workBoardBar.getByTestId("workboard-main-banner")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(workBoardBar.getByTestId("workboard-active-button")).toBeInTheDocument();
    expect(
      workBoardBar
        .getByTestId("workboard-active-button")
        .compareDocumentPosition(workBoardBar.getByTestId("workboard-phase-summary")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(workBoardBar.queryByTestId("workboard-current-thread")).toBeNull();
    expect(workBoardBar.getByTestId("thread-main-tab")).toHaveTextContent("Main Thread");
    expect(workBoardBar.getByTestId("thread-main-tab")).toHaveAttribute("aria-pressed", "true");
    expect(workBoardBar.getByTestId("thread-main-tab")).toHaveClass(
      "border-cc-primary/45",
      "border-b-transparent",
      "bg-cc-card",
      "text-cc-fg",
    );
    expect(workBoardBar.getByTestId("thread-main-tab")).not.toHaveClass(
      "border-violet-100/45",
      "border-amber-400/60",
      "border-cc-primary/70",
    );
    expect(workBoardBar.getByTestId("workboard-phase-summary")).toHaveTextContent("1 Work");
    const mainTitle = within(workBoardBar.getByTestId("thread-main-tab")).getByTestId("thread-tab-title");
    expect(mainTitle).toHaveAttribute("data-active-output", "false");
    expect(
      within(workBoardBar.getByTestId("thread-main-tab")).queryByTestId("thread-tab-active-output-indicator"),
    ).toBeNull();
    expect(mainTitle.getAttribute("style") ?? "").not.toContain("animation");
    expect(mainTitle).not.toHaveClass("border");
    expect(mainTitle).not.toHaveClass("bg-sky-400/10");

    const tabs = workBoardBar.getAllByTestId("thread-tab");
    expect(tabs.map((tab) => tab.getAttribute("data-min-label"))).toEqual(["q-1932", "q-42", "q-55"]);
    expect(within(rail).queryByText("Active")).not.toBeInTheDocument();
    expect(tabs[0]).toHaveClass(
      "min-w-[var(--thread-tab-width)]",
      "max-w-[14rem]",
      "flex-[1_1_var(--thread-tab-width)]",
    );
    const q42Tab = tabs.find((tab) => tab.getAttribute("data-thread-key") === "q-42");
    expect(q42Tab).toBeTruthy();
    expect(q42Tab!).toHaveAttribute("data-closable", "false");
    expect(within(q42Tab!).queryByTestId("thread-tab-close")).not.toBeInTheDocument();
    fireEvent.click(moreButton);
    const moreRows = workBoardBar.getAllByTestId("thread-tabs-more-row");
    expect(moreRows.map((row) => row.getAttribute("data-thread-key"))).toEqual(["q-61", "q-77", "q-88"]);
    expect(moreRows.find((row) => row.getAttribute("data-thread-key") === "q-61")).toHaveAttribute(
      "data-hidden",
      "true",
    );
    expect(moreRows.find((row) => row.getAttribute("data-thread-key") === "q-77")).toHaveAttribute(
      "data-hidden",
      "true",
    );
    expect(moreRows.find((row) => row.getAttribute("data-thread-key") === "q-88")).toHaveAttribute(
      "data-hidden",
      "true",
    );
    const completedMoreRow = moreRows.find((row) => row.getAttribute("data-thread-key") === "q-88")!;
    // The Playground keeps this completed row in authoritative Thread Waiting,
    // so its hidden title demonstrates the temporary normal-foreground override.
    expect(within(completedMoreRow).getByTestId("thread-tabs-more-row-title")).toHaveAttribute(
      "data-title-color",
      "var(--color-cc-fg)",
    );
    fireEvent.click(moreButton);
    const activeOutputTab = tabs.find((tab) => tab.getAttribute("data-thread-key") === "q-42");
    expect(activeOutputTab).toHaveAttribute("data-active-output", "true");
    const activeOutputMarker = within(activeOutputTab!).getByTestId("thread-tab-active-output-indicator");
    expect(activeOutputMarker).toHaveAttribute("data-reduced-motion-static", "true");
    expect(activeOutputMarker).toHaveAttribute("data-dot-position", "stripe-origin");
    expect(activeOutputMarker).toHaveAttribute("data-stripe-origin", "top-left");
    expect(activeOutputMarker).toHaveClass("inset-0");
    expect(within(activeOutputMarker).getByTestId("thread-tab-active-output-glint-track")).toHaveClass("inset-x-1");
    expect(within(activeOutputMarker).getByTestId("thread-tab-active-output-glint")).toHaveClass(
      "thread-tab-output-glint",
    );
    expect(within(activeOutputMarker).getByTestId("thread-tab-active-output-dot")).toHaveClass(
      "left-1",
      "top-0",
      "h-2",
      "w-2",
      "-translate-x-1/2",
      "-translate-y-1/2",
    );
    expect(within(activeOutputTab!).getByTestId("thread-tab-needs-input-bell")).toHaveClass("relative", "z-10");
    expect(within(activeOutputTab!).getByTestId("thread-tab-title")).toHaveAttribute("data-active-output", "true");
    expect(within(activeOutputTab!).getByTestId("thread-tab-title").getAttribute("style") ?? "").not.toContain(
      "animation",
    );
    const queuedTab = tabs.find((tab) => tab.getAttribute("data-thread-key") === "q-55");
    expect(queuedTab).toHaveAttribute("data-active-output", "false");
    expect(within(queuedTab!).queryByTestId("thread-tab-active-output-indicator")).toBeNull();
    expect(within(queuedTab!).getByTestId("thread-tab-title")).toHaveAttribute(
      "data-title-color",
      "var(--color-cc-fg)",
    );
    expect(moreRows.find((row) => row.getAttribute("data-thread-key") === "q-88")).toHaveTextContent(
      "Reviewed collapsed-result handling",
    );
    const activeQuestTab = tabs.find((tab) => tab.getAttribute("data-thread-key") === "q-42");
    expect(activeQuestTab).toHaveAttribute("data-has-quest-hover", "true");
    expect(activeQuestTab).not.toHaveAttribute("title");
    expect(within(activeQuestTab!).queryByRole("button", { name: /Preview q-/ })).toBeNull();

    fireEvent.mouseEnter(activeQuestTab!);
    const hoverCard = await screen.findByTestId("quest-hover-card");
    expect(within(hoverCard).getByText("Fix mobile sidebar overflow")).toBeTruthy();
    expect(within(hoverCard).getByTestId("quest-journey-preview-card")).toBeTruthy();
    const journey = within(hoverCard).getByTestId("quest-journey-timeline");
    expect(journey).toHaveAttribute("data-journey-mode", "active");
    expect(
      Array.from(journey.querySelectorAll("li[data-phase-index]")).map((row) =>
        Number(row.getAttribute("data-phase-index")),
      ),
    ).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    expect(within(journey).getByText("Sixth previous phase hidden by default in tab hover previews.")).toBeTruthy();
    expect(within(journey).getByText("First visible previous phase for the tab hover clamp.")).toBeTruthy();
    expect(within(journey).getByRole("button", { name: "Show 2 earlier phases" })).toBeTruthy();
    expect(within(hoverCard).getByTestId("quest-hover-worker-session")).toHaveTextContent("Worker");
    expect(within(hoverCard).queryByTestId("quest-hover-reviewer-session")).toBeNull();
    expect(within(hoverCard).getByRole("link", { name: "Worker #5 Clear Mesa" })).toBeTruthy();
    expect(within(hoverCard).queryByRole("link", { name: "Reviewer #6 Review Lead" })).toBeNull();

    fireEvent.click(workBoardBar.getByRole("button", { name: "Quest thread" }));
    const selectedActiveQuestTab = workBoardBar
      .getAllByTestId("thread-tab")
      .find((tab) => tab.getAttribute("data-thread-key") === "q-42")!;
    expect(within(selectedActiveQuestTab).getByTestId("thread-tab-select")).toHaveAttribute("aria-pressed", "true");
    expect(selectedActiveQuestTab).toHaveClass(
      "border-cc-primary/45",
      "border-b-transparent",
      "bg-cc-card",
      "text-cc-fg",
    );
    expect(selectedActiveQuestTab).not.toHaveClass("border-violet-100/45", "border-amber-400/60");
    expect(selectedActiveQuestTab).toHaveAttribute("data-active-output", "true");
    expect(within(selectedActiveQuestTab).getByTestId("thread-tab-active-output-indicator")).toBeTruthy();

    fireEvent.click(workBoardBar.getByText("Simulate moved-message tab"));
    const movedTabs = workBoardBar.getAllByTestId("thread-tab");
    expect(movedTabs[0]).toHaveAttribute("data-thread-key", "q-99");
    expect(movedTabs[0]).toHaveAttribute("data-new-tab", "true");
    expect(workBoardBar.queryByTestId("workboard-main-banner")).toBeNull();
    expect(workBoardBar.getByTestId("thread-tab-rail")).toBeTruthy();

    fireEvent.click(workBoardBar.getByText("Main banner"));
    expect(workBoardBar.getByTestId("workboard-projection-main")).toHaveAttribute("aria-pressed", "true");
    expect(workBoardBar.getByTestId("workboard-projection-all")).toHaveAttribute("aria-pressed", "false");
    expect(workBoardBar.getByTestId("workboard-other-button")).toHaveTextContent("3Other");
    expect(workBoardBar.queryByTestId("workboard-off-board-threads")).toBeNull();
    fireEvent.click(workBoardBar.getByTestId("workboard-other-button"));
    expect(workBoardBar.getByTestId("workboard-other-threads-content")).toHaveTextContent(
      "Off-board routed discussion",
    );
  });

  it("documents an unselected completed Waiting tab with normal foreground text", () => {
    // The dedicated control makes the completed-plus-Waiting state visible in
    // the real Playground component while Main remains selected as a contrast.
    setMeasuredRailWidth(392);
    render(<Playground />);

    const workBoardBar = getPlaygroundSection("interactive-work-board-bar");
    fireEvent.click(workBoardBar.getByText("Seed board data"));
    fireEvent.click(workBoardBar.getByText("Show waiting completed tab"));

    const waitingTab = workBoardBar
      .getAllByTestId("thread-tab")
      .find((tab) => tab.getAttribute("data-thread-key") === "q-88")!;
    expect(within(waitingTab).getByTestId("thread-tab-select")).toHaveAttribute("aria-pressed", "false");
    expect(within(waitingTab).getByTestId("thread-tab-title")).toHaveAttribute(
      "data-title-color",
      "var(--color-cc-fg)",
    );
    expect(within(waitingTab).queryByTestId("thread-tab-needs-input-bell")).toBeNull();
    expect(within(waitingTab).queryByTestId("thread-tab-blue-notification-bell")).toBeNull();
    expect(within(waitingTab).queryByTestId("thread-tab-active-output-indicator")).toBeNull();
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

  it("documents the desktop Work Board Bar tab crowd overflowing into More before labels collapse", () => {
    setMeasuredRailWidth(1880);
    render(<Playground />);

    const workBoardBar = getPlaygroundSection("interactive-work-board-bar");
    fireEvent.click(workBoardBar.getByText("Seed board data"));
    fireEvent.click(workBoardBar.getByText("Simulate desktop tab crowd"));

    const rail = workBoardBar.getByTestId("thread-tab-rail");
    expect(rail).toHaveAttribute("data-overflow", "more-tabs-list");
    const tabs = workBoardBar.getAllByTestId("thread-tab");
    expect(tabs.map((tab) => tab.getAttribute("data-thread-key"))).toEqual([
      "q-42",
      "q-1101",
      "q-1102",
      "q-1103",
      "q-1104",
      "q-1105",
      "q-1106",
      "q-1107",
      "q-1108",
      "q-1112",
    ]);
    expect(workBoardBar.getByTestId("thread-tab-strip").getAttribute("style") ?? "").toContain(
      "--thread-tab-width: 160px",
    );
    expect(tabs[0]).toHaveClass("min-w-[var(--thread-tab-width)]", "flex-[1_1_var(--thread-tab-width)]");
    expect(workBoardBar.getByTestId("thread-tabs-more-button")).toHaveAttribute("data-hidden-count", "7");
  });

  it("documents compact quest-thread banners without chip note counts and with tap previews", () => {
    render(<Playground />);

    expect(screen.getAllByText(/long Quest Journey preview clamped around the current phase/).length).toBeGreaterThan(
      0,
    );

    const banner = screen.getAllByTestId("quest-thread-banner")[0];
    expect(banner).toHaveClass("py-1");
    expect(within(banner).getByTestId("quest-thread-meta-strip")).toHaveClass("flex-[1_1_auto]");
    expect(within(banner).getByTestId("quest-thread-participant-strip")).toHaveClass("inline-flex");
    expect(within(banner).getByTestId("quest-journey-compact-summary")).toHaveTextContent("Work");
    expect(within(banner).getByTestId("quest-journey-compact-summary")).not.toHaveTextContent("note");
    expect(within(banner).getByLabelText("Worker #1321 Clear Mesa")).toBeTruthy();
    expect(within(banner).queryByLabelText("Reviewer #1306 Review Lead")).toBeNull();
    expect(within(banner).getByTestId("quest-thread-commit-button")).toHaveTextContent("2 commits");
    const mobileParticipantPreview = screen.getByTestId("playground-mobile-participant-labels");
    const mobileParticipantBanners = within(mobileParticipantPreview).getAllByTestId("quest-thread-banner");
    expect(within(mobileParticipantBanners[0]).getByText("Worker")).toHaveClass("max-[319px]:hidden");
    expect(within(mobileParticipantBanners[0]).getByTestId("session-role-icon-worker")).toBeInTheDocument();
    expect(within(mobileParticipantBanners[1]).getByText("Leader")).toHaveClass("max-[319px]:hidden");
    expect(within(mobileParticipantBanners[1]).getByTestId("session-role-icon-leader")).toBeInTheDocument();
    // Styling matches across roles, while the links retain their distinct identities and navigation destinations.
    const workerLink = within(mobileParticipantBanners[0]).getByRole("link", { name: /^Worker #/ });
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
    expect(within(checkpointBanner).getByLabelText("Worker #1321 Clear Mesa")).toBeTruthy();
    expect(within(queuedBanner).getByTestId("quest-thread-queued-status-chip")).toHaveTextContent(
      "Queued, waiting for #1801, q-1367, free worker",
    );
    expect(within(queuedBanner).queryByTestId("quest-thread-wait-pill")).not.toBeInTheDocument();
    // Mobile keeps Journey on the first row; queued dependencies remain available below it.
    expect(within(queuedBanner).getByTestId("quest-journey-compact-summary")).toHaveTextContent("Journey");
    const staleQueuedDoneBanner = screen.getAllByTestId("quest-thread-banner")[2];
    expect(within(staleQueuedDoneBanner).queryByTestId("quest-thread-queued-status-chip")).not.toBeInTheDocument();
    expect(staleQueuedDoneBanner).not.toHaveTextContent("Queued, waiting for free worker");
    expect(within(staleQueuedDoneBanner).getByTestId("quest-journey-compact-summary")).toHaveTextContent("Completed");

    fireEvent.click(within(banner).getByTestId("quest-thread-journey-hover-target"));
    const hoverCard = screen.getByTestId("quest-thread-journey-hover-card");
    expect(hoverCard).toBeTruthy();
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
