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
import { PlaygroundOverviewSections } from "./playground/sections-overview.js";
import { useStore } from "../store.js";
import {
  installPlaygroundTestEnvironment,
  PlaygroundOverviewOnly,
  setMeasuredRailWidth,
} from "./Playground.test-helpers.js";

// Playground tests are split across Playground*.test.tsx files so the heavy full-catalog
// renders run in parallel workers. This file: overview-section Playground fixtures.
installPlaygroundTestEnvironment();

// A full-catalog render costs about 4-8 s of CPU on its own, so several concurrent
// suite runs need more than the default 10 s; tests with larger needs set their own.
describe("Playground", { timeout: 30_000 }, () => {
  it("documents Leader-only inline timing suppression without losing menu time metadata", () => {
    useStore.getState().reset();
    render(<PlaygroundOverviewOnly />);

    const normalTiming = within(screen.getByTestId("playground-normal-inline-timing"));
    expect(normalTiming.getByTestId("message-timestamp")).toHaveTextContent("· 42s");

    const leaderTiming = within(screen.getByTestId("playground-leader-inline-timing"));
    expect(leaderTiming.queryByTestId("message-timestamp")).not.toBeInTheDocument();
    fireEvent.click(leaderTiming.getByRole("button", { name: "Message options" }));
    const leaderMetadata = screen.getByTestId("message-time-assistant-menu-metadata");
    expect(leaderMetadata).toHaveAttribute("role", "note");
    expect(leaderMetadata).toHaveTextContent("Message time");
    expect(within(leaderMetadata).getByRole("time")).toBeInTheDocument();
    expect(leaderMetadata).not.toHaveTextContent("Time unavailable");
    fireEvent.keyDown(document, { key: "Escape" });

    const validMenu = within(screen.getByTestId("playground-valid-message-menu"));
    fireEvent.click(validMenu.getByRole("button", { name: "Message options" }));
    expect(screen.getByTestId("message-time-user-menu-metadata")).not.toHaveTextContent("Time unavailable");
    fireEvent.keyDown(document, { key: "Escape" });

    const unavailableMenu = within(screen.getByTestId("playground-unavailable-message-menu"));
    fireEvent.click(unavailableMenu.getByRole("button", { name: "Message options" }));
    const unavailableMetadata = screen.getByTestId("message-time-user-menu-metadata");
    expect(unavailableMetadata).toHaveTextContent("Message time");
    expect(unavailableMetadata).toHaveTextContent("Time unavailable");
    expect(within(unavailableMetadata).queryByRole("button")).not.toBeInTheDocument();
  });

  it("documents inline, display, malformed, wide, and streaming math states", () => {
    // The Playground is the browser-validation fixture for every message-flow
    // Markdown state introduced by the shared math renderer.
    render(<PlaygroundOverviewSections />);

    expect(screen.getByRole("heading", { name: "Markdown Math" })).toBeTruthy();
    expect(screen.getByText("Assistant message — inline and display delimiter compatibility")).toBeTruthy();
    expect(screen.getByText("Wide display math — constrained mobile-width surface")).toBeTruthy();
    expect(screen.getByText("Rendered selection — copy and quote use one source token")).toBeTruthy();
    expect(screen.getByText("Malformed, unsupported, and streaming delimiter states")).toBeTruthy();
    const streamingFixture = screen.getByTestId("playground-streaming-math");
    const incompleteOutput = streamingFixture.textContent;
    expect(streamingFixture).toHaveAttribute("data-stream-complete", "false");

    fireEvent.click(screen.getByRole("button", { name: "Toggle streaming delimiter" }));
    expect(streamingFixture).toHaveAttribute("data-stream-complete", "true");
    expect(streamingFixture.textContent).not.toBe(incompleteOutput);
  });

  it("documents native browser opening and retained alternatives for HTML file links", () => {
    // The shared message-link change must remain directly inspectable in the Playground.
    render(<PlaygroundOverviewSections />);

    expect(screen.getByRole("heading", { name: "File Link Context Menu" })).toBeTruthy();
    expect(screen.getByText("Chat markdown with browser, editor, and image file links")).toBeTruthy();
    expect(screen.getByText(/interactive HTML demo/)).toBeTruthy();
  });

  it("documents multi-file Write blocks whose change diff fields contain raw file content", () => {
    render(<PlaygroundOverviewSections />);

    expect(screen.getByRole("button", { name: /Write File.*2 files/ })).toBeTruthy();
    expect(screen.getByText("full_datagen_inner.sh")).toBeTruthy();
    expect(screen.getByText("launch_tmux_retry.sh")).toBeTruthy();
    expect(document.body).toHaveTextContent("set -uo pipefail");
    expect(document.body).toHaveTextContent("tmux new-session");
  });

  it("documents visible, expanded, and acknowledged-hidden migration notice states", () => {
    // Playground must retain all user-visible states needed by the later desktop/mobile Execute pass.
    render(<PlaygroundOverviewSections />);

    const compactCard = screen.getByText("Compact migration notice").parentElement?.parentElement;
    const expandedCard = screen.getByText("Expanded migration details").parentElement?.parentElement;
    const hiddenCard = screen.getByText("Acknowledged migration hidden").parentElement?.parentElement;
    expect(compactCard).toBeTruthy();
    expect(expandedCard).toBeTruthy();
    expect(hiddenCard).toBeTruthy();
    expect(within(compactCard!).getByRole("status", { name: "Model provenance migration notice" })).toBeTruthy();
    expect(expandedCard?.querySelector("details")).toHaveAttribute("open");
    expect(within(hiddenCard!).queryByRole("status", { name: "Model provenance migration notice" })).toBeNull();
    expect(screen.getByTestId("playground-acknowledged-migration-hidden")).toBeEmptyDOMElement();
  });

  it("documents projected scheduled priority and dismissal parity on desktop and mobile", () => {
    setMeasuredRailWidth(430);
    render(<PlaygroundOverviewOnly />);

    const desktop = within(screen.getByTestId("playground-projected-thread-tabs-desktop"));
    const mobile = within(screen.getByTestId("playground-projected-thread-tabs-mobile"));
    for (const scope of [desktop, mobile]) {
      const rail = scope.getByTestId("thread-tab-rail");
      expect(rail).toHaveAttribute("data-overflow", "more-tabs-list");
      // Five hidden tabs: three scheduled/muted specimens plus two tabs for quests this leader handed away.
      expect(rail).toHaveAttribute("data-hidden-tab-count", "5");
      const visibleTabs = scope.getAllByTestId("thread-tab");
      expect(visibleTabs.map((tab) => tab.getAttribute("data-thread-key"))).toEqual(["q-9001", "q-9004", "q-9003"]);
      const needsInput = visibleTabs.find((tab) => tab.getAttribute("data-thread-key") === "q-9001")!;
      const completedWaiting = visibleTabs.find((tab) => tab.getAttribute("data-thread-key") === "q-9004")!;
      const reviewUnread = visibleTabs.find((tab) => tab.getAttribute("data-thread-key") === "q-9003")!;
      expect(needsInput).toHaveAttribute("data-needs-input", "true");
      expect(needsInput).toHaveAttribute("data-blue-notification", "true");
      expect(within(needsInput).getByTestId("thread-tab-needs-input-bell")).toBeTruthy();
      expect(within(needsInput).queryByTestId("thread-tab-blue-notification-bell")).toBeNull();
      expect(needsInput).toHaveAttribute("data-closable", "false");
      expect(within(needsInput).queryByTestId("thread-tab-close")).toBeNull();
      expect(within(needsInput).getByTestId("thread-tab-title")).toHaveAttribute(
        "data-title-color",
        "var(--color-cc-phase-thread-tab-title-work, #166534)",
      );
      fireEvent.mouseEnter(needsInput);
      expect(within(needsInput).getByTestId("thread-tab-title")).toHaveAttribute(
        "data-title-color",
        "var(--color-cc-phase-thread-tab-title-work, #166534)",
      );
      expect(completedWaiting).toHaveAttribute("data-closable", "true");
      expect(within(completedWaiting).getByTestId("thread-tab-title")).toHaveAttribute(
        "data-title-color",
        "var(--color-cc-fg)",
      );
      expect(reviewUnread).toHaveAttribute("data-blue-notification", "true");
      expect(reviewUnread).toHaveAttribute("data-closable", "true");
      expect(within(reviewUnread).getByTestId("thread-tab-blue-notification-bell")).toBeTruthy();
      expect(within(reviewUnread).getByRole("button", { name: "Close q-9003" })).toBeTruthy();
      expect(scope.getByTestId("thread-tabs-more-button")).toHaveAttribute("data-has-muted-needs-input", "true");

      fireEvent.click(within(needsInput).getByTestId("thread-tab-select"));
      fireEvent.click(scope.getByTestId("quest-thread-journey-hover-target"));
      const preview = within(screen.getAllByTestId("quest-thread-journey-hover-card").at(-1)!).getByTestId(
        "quest-journey-preview-card",
      );
      expect(preview).toHaveTextContent("3 phases · Total 4m");
      expect(
        within(preview)
          .getAllByTestId("quest-journey-phase-duration")
          .map((node) => node.textContent),
      ).toEqual(["1m", "3m"]);
      expect(preview).not.toHaveTextContent("Duration unavailable");
    }

    fireEvent.click(mobile.getByTestId("thread-tabs-more-button"));
    const moreRows = mobile.getAllByTestId("thread-tabs-more-row");
    expect(moreRows.map((row) => row.getAttribute("data-thread-key"))).toEqual([
      "q-9005",
      "q-9002",
      "q-9006",
      "q-9010",
      "q-9011",
    ]);
    const mutedRow = moreRows[0]!;
    const queuedRow = moreRows[1]!;
    const proposedRow = moreRows[2]!;
    expect(mutedRow).toHaveAttribute("data-muted-needs-input", "true");
    expect(within(mutedRow).getByTestId("thread-tab-muted-needs-input-bell")).toBeTruthy();
    expect(within(mutedRow).getByRole("button", { name: "Close q-9005" })).toBeTruthy();
    expect(within(queuedRow).getByRole("button", { name: "Close q-9002" })).toBeTruthy();
    expect(within(proposedRow).getByRole("button", { name: "Close q-9006" })).toBeTruthy();
    // Quests another leader runs, or no board holds, say so and stay closable.
    const handedRow = moreRows[3]!;
    const offBoardRow = moreRows[4]!;
    expect(handedRow).toHaveTextContent("Led by #2851");
    expect(within(handedRow).getByTestId("thread-tab-led-elsewhere-icon")).toBeTruthy();
    expect(within(handedRow).getByRole("button", { name: "Close q-9010" })).toBeTruthy();
    expect(offBoardRow).toHaveTextContent("Not on board");
    expect(within(offBoardRow).getByRole("button", { name: "Close q-9011" })).toBeTruthy();
  });

  it("documents additive source projection without source attachment markers", () => {
    render(<PlaygroundOverviewOnly />);

    expect(screen.queryByText("Thread opened")).toBeNull();
    expect(
      screen
        .getAllByTestId("attention-ledger-row")
        .some((row) => row.getAttribute("data-attention-type") === "quest_thread_created"),
    ).toBe(false);

    expect(screen.getAllByText("Earlier context attached to the implementation quest.").length).toBeGreaterThan(0);

    const marker = screen.getAllByTestId("thread-system-marker-cluster")[0];
    expect(marker).toHaveTextContent("Work continued from Main to thread:q-9002");
    expect(marker).not.toHaveTextContent("activities in thread:");
    expect(within(marker).queryByText("Jump")).toBeNull();
    expect(within(marker).getByRole("button", { name: "Main" })).toBeTruthy();
    expect(within(marker).getAllByRole("button", { name: "thread:q-9002" }).length).toBeGreaterThan(0);
    fireEvent.click(within(marker).getByRole("button", { name: "Details" }));
    expect(marker).toHaveTextContent("1 message moved to thread:q-9001");
    expect(
      screen.queryByLabelText(
        "Thread Waiting for thread:q-9002: waiting for q-9001 to finish before mobile status chip wrapping can be visually checked on the narrow add-to-home-screen layout",
      ),
    ).toBeNull();
    expect(screen.getByLabelText("Thread Ready for thread:q-9003: dispatch plan is ready")).toBeTruthy();
    const phaseThread = screen.getByTestId("playground-codex-phase-thread");
    const phaseFinal = within(phaseThread).getByText(
      "The dispatch plan is ready with the requested worker assignment.",
    );
    expect(phaseFinal).toBeTruthy();
    expect(
      within(phaseThread).queryByText("Checking the internal worker queue before publishing the dispatch plan."),
    ).toBeNull();
    const phaseTurn = phaseFinal.closest("[data-turn-id]");
    expect(phaseTurn).toBeTruthy();
    const phaseActivityButtons = within(phaseTurn as HTMLElement).getAllByRole("button", {
      name: /Show turn activity/,
    });
    fireEvent.click(phaseActivityButtons.at(-1)!);
    expect(
      within(phaseThread).getByText("Checking the internal worker queue before publishing the dispatch plan."),
    ).toBeTruthy();
    expect(document.querySelector('[data-message-id="playground-thread-status-batch"]')).toBeNull();
    expect(screen.getAllByText("The initial q-9001 answer is complete and remains in history.").length).toBeGreaterThan(
      0,
    );
    expect(
      screen.queryByLabelText("Thread Ready for thread:q-9001: initial implementation answer complete"),
    ).toBeNull();

    const questProjection = screen.getByTestId("playground-quest-thread-projection");
    // Later work in the selected quest retires its earlier departure.
    expect(questProjection).not.toHaveTextContent("Work continued from current thread to thread:q-9002");
    expect(questProjection).not.toHaveTextContent("Work continued from thread:q-9002 to thread:q-9001");

    const allProjection = screen.getByTestId("playground-all-thread-projection");
    expect(allProjection).toHaveTextContent("Work continued from thread:q-9001 to thread:q-9002");
    expect(allProjection).toHaveTextContent("Work continued from thread:q-9002 to thread:q-9001");
    expect(within(allProjection).queryByRole("button", { name: "current thread" })).toBeNull();

    const mainProjection = screen.getByTestId("playground-main-thread-projection");
    // The later Main approval prose likewise retires Main's earlier departure.
    expect(mainProjection).not.toHaveTextContent("Work continued from current thread to thread:q-9002");
    expect(mainProjection).not.toHaveTextContent("Work continued from thread:q-9001 to thread:q-9002");
  });
});
