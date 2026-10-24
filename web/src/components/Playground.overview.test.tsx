// @vitest-environment jsdom

import { closeAllThreadTabs, listedThreadTab } from "../test-fixtures/thread-tab-rows.js";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
import { installPlaygroundTestEnvironment, PlaygroundOverviewOnly } from "./Playground.test-helpers.js";

// Playground tests are split across Playground*.test.tsx files so the heavy full-catalog
// renders run in parallel workers. This file: overview-section Playground fixtures.
installPlaygroundTestEnvironment();

// A full-catalog render costs about 4-8 s of CPU on its own, so several concurrent
// suite runs need more than the default 10 s; tests with larger needs set their own.
describe("Playground", { timeout: 30_000 }, () => {
  it("documents corner message times, clustering and menu time metadata", async () => {
    useStore.getState().reset();
    render(<PlaygroundOverviewOnly />);

    const normalTiming = within(screen.getByTestId("playground-normal-inline-timing"));
    expect(normalTiming.getByTestId("message-time-label")).toHaveTextContent("· 42s");

    const leaderTiming = within(screen.getByTestId("playground-leader-inline-timing"));
    expect(leaderTiming.getByTestId("message-time-label")).not.toHaveTextContent("·");

    // In the clustered exchange, the older message of each close pair keeps an invisible label.
    const clustered = within(screen.getByTestId("playground-clustered-message-times"));
    await waitFor(() => {
      expect(clustered.getAllByTestId("message-time-label").map((label) => label.dataset.hidden === "true")).toEqual([
        true,
        false,
        true,
        false,
        false,
      ]);
    });
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

  it("documents file links: the viewer for folders, code and Markdown, a tab for HTML", () => {
    // The shared message-link change must remain directly inspectable in the Playground.
    render(<PlaygroundOverviewSections />);

    expect(screen.getByRole("heading", { name: "File Link Context Menu" })).toBeTruthy();
    expect(screen.getByText("Chat markdown with folder, code, Markdown, HTML and image file links")).toBeTruthy();
    expect(screen.getByText(/interactive HTML demo/)).toBeTruthy();
    expect(screen.getByText(/\[its folder\]/)).toBeTruthy();
    expect(screen.getByText(/markdown-reports\.md/)).toBeTruthy();
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
    render(<PlaygroundOverviewOnly />);

    // Desktop and mobile widths show the same status groups; every tab is listed, under
    // its group, in the all-tabs sheet.
    for (const testId of ["playground-projected-thread-tabs-desktop", "playground-projected-thread-tabs-mobile"]) {
      const container = screen.getByTestId(testId);
      const tab = (threadKey: string) => listedThreadTab(threadKey, container)!;

      const needsInput = tab("q-9001");
      expect(needsInput).toHaveAttribute("data-needs-input", "true");
      expect(needsInput).toHaveAttribute("data-blue-notification", "true");
      expect(within(needsInput).getAllByTestId("thread-tab-bell")).toHaveLength(1);
      expect(within(needsInput).getByTestId("thread-tab-bell")).toHaveAttribute("data-kind", "needs-input");
      expect(needsInput).toHaveAttribute("data-closable", "false");
      expect(within(needsInput).queryByTestId("thread-tab-list-row-close")).toBeNull();
      expect(needsInput).toHaveAttribute("data-title-color", "var(--color-cc-phase-thread-tab-title-work, #166534)");

      const completedWaiting = tab("q-9004");
      expect(completedWaiting).toHaveAttribute("data-closable", "true");
      expect(completedWaiting).toHaveAttribute("data-title-color", "var(--color-cc-fg)");

      const reviewUnread = tab("q-9003");
      expect(reviewUnread).toHaveAttribute("data-blue-notification", "true");
      expect(within(reviewUnread).getByTestId("thread-tab-bell")).toHaveAttribute("data-kind", "review");
      expect(within(reviewUnread).getByRole("button", { name: "Close q-9003" })).toBeTruthy();

      const muted = tab("q-9005");
      expect(muted).toHaveAttribute("data-muted-needs-input", "true");
      expect(within(muted).getByTestId("thread-tab-bell")).toHaveAttribute("data-kind", "muted");
      expect(within(muted).getByRole("button", { name: "Close q-9005" })).toBeTruthy();
      expect(within(tab("q-9002")).getByRole("button", { name: "Close q-9002" })).toBeTruthy();
      expect(within(tab("q-9006")).getByRole("button", { name: "Close q-9006" })).toBeTruthy();

      // Quests another leader runs, or no board holds, say so and stay closable.
      const handed = tab("q-9010");
      expect(handed).toHaveTextContent("Led by #2851");
      expect(within(handed).getByTestId("thread-tab-led-elsewhere-icon")).toBeTruthy();
      expect(within(handed).getByRole("button", { name: "Close q-9010" })).toBeTruthy();
      const offBoard = tab("q-9011");
      expect(offBoard).toHaveTextContent("Not on board");
      expect(within(offBoard).getByRole("button", { name: "Close q-9011" })).toBeTruthy();

      // Opening the prompt's tab shows its quest strip with the timed Journey preview.
      fireEvent.click(within(needsInput).getByTestId("thread-tab-list-row-select"));
      fireEvent.click(within(container).getByTestId("quest-thread-journey-hover-target"));
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
      closeAllThreadTabs();
    }
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

    const marker = screen.getAllByTestId("thread-attachment-marker")[0]!;
    expect(marker).toHaveTextContent("1 message moved to thread:q-9001");
    expect(marker).not.toHaveTextContent("activities in thread:");
    expect(within(marker).queryByText("Jump")).toBeNull();
    expect(within(marker).getByRole("button", { name: "thread:q-9001" })).toBeTruthy();
    fireEvent.click(within(marker).getByRole("button", { name: "Details" }));
    expect(marker).toHaveTextContent("Ranges: 1");
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

    // No view shows the retired "Work continued" handoff labels, All Threads included.
    for (const testId of [
      "playground-quest-thread-projection",
      "playground-all-thread-projection",
      "playground-main-thread-projection",
    ]) {
      expect(screen.getByTestId(testId)).not.toHaveTextContent("Work continued");
    }
  });
});
