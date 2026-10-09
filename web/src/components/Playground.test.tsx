// @vitest-environment jsdom

import { act, fireEvent, render, screen, within } from "@testing-library/react";
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
import { PlaygroundSideChatStates } from "./playground/SideChatPlaygroundStates.js";
import { PlaygroundReasoningDetailStates } from "./playground/ReasoningDetailStates.js";
import { PlaygroundCodexSubagentStates } from "./playground/CodexSubagentPlaygroundStates.js";
import { PlaygroundDiffViewerSection } from "./playground/DiffViewerPlaygroundSection.js";
import { PlaygroundUniversalSearchStates } from "./playground/search-sidebar-states.js";
import {
  PlaygroundDelegateTaskPendingLiveActivityGroup,
  PlaygroundDelegateTaskPendingNoHandoffGroup,
  PlaygroundHerdSummaryBar,
  PlaygroundSelectionContextMenu,
} from "./playground/shared.js";
import { useStore } from "../store.js";
import {
  getPlaygroundSection,
  getPlaygroundSectionByTitle,
  installPlaygroundTestEnvironment,
} from "./Playground.test-helpers.js";

// Playground tests are split across Playground*.test.tsx files so the heavy full-catalog
// renders run in parallel workers. This file: chat stack, composer and smaller Playground fixtures.
installPlaygroundTestEnvironment();

// A full-catalog render costs about 4-8 s of CPU on its own, so several concurrent
// suite runs need more than the default 10 s; tests with larger needs set their own.
describe("Playground", { timeout: 30_000 }, () => {
  it("contrasts one-message-per-destination Recent browsing with exhaustive scoped Messages hits", async () => {
    // The paired fixture makes the product boundary inspectable without relying on live session history.
    render(<PlaygroundUniversalSearchStates />);

    const recentPreview = within(screen.getByTestId("playground-universal-recent-preview"));
    expect(
      recentPreview.getByText("Recent shows one newest human message for each navigable destination."),
    ).toBeTruthy();
    expect(await recentPreview.findAllByTestId("recent-ask-bundle")).toHaveLength(3);
    expect(recentPreview.getAllByRole("button", { name: /Open newest message in/ })).toHaveLength(3);
    // Attachment-only messages stay visible; the mixed row retains text and both counts.
    const recentRows = recentPreview.getAllByTestId("recent-ask-bundle");
    expect(within(recentRows[0]!).getByTitle("1 image attachment")).toBeInTheDocument();
    expect(within(recentRows[0]!).getByTitle("2 comment attachments")).toBeInTheDocument();
    expect(within(recentRows[1]!).queryByTestId("recent-ask-text")).toBeNull();
    expect(within(recentRows[1]!).getByTitle("2 comment attachments")).toBeInTheDocument();
    expect(within(recentRows[2]!).queryByTestId("recent-ask-text")).toBeNull();
    expect(within(recentRows[2]!).getByTitle("1 image attachment")).toBeInTheDocument();

    const messagesPreview = within(screen.getByTestId("playground-universal-messages-preview"));
    expect(
      messagesPreview.getByText(
        "Messages keeps every match in the selected scope, including multiple messages from the same destination.",
      ),
    ).toBeTruthy();
    expect(messagesPreview.getByText("Searching in #1277 across tabs")).toBeTruthy();
    expect(messagesPreview.getByRole("button", { name: "Current tab" })).toHaveAttribute("aria-pressed", "false");
    expect(messagesPreview.getByRole("button", { name: "Current tab" })).toBeDisabled();
    expect(messagesPreview.getByRole("button", { name: "Across tabs" })).toHaveAttribute("aria-pressed", "true");
    const messageRows = await messagesPreview.findAllByRole("option");
    expect(messageRows).toHaveLength(3);
    expect(messageRows[0]).toHaveTextContent(
      "Search should return every matching message in scope instead of one result per destination.",
    );
    expect(messageRows[1]).toHaveTextContent("When a search has two matching messages in this tab, keep both results.");
    expect(messageRows.filter((row) => row.textContent?.includes("Thread q-1931"))).toHaveLength(2);
    expect(messageRows[2]).toHaveTextContent("Thread q-1927");
  });

  it("documents collapsed and expanded grouped reasoning-detail states", () => {
    useStore.getState().reset();
    render(<PlaygroundReasoningDetailStates />);

    expect(screen.getByText("Grouped collapsed")).toBeInTheDocument();
    expect(screen.getByText("Grouped expanded")).toBeInTheDocument();
    const groups = screen.getAllByTestId("codex-reasoning-detail-group");
    expect(groups).toHaveLength(2);
    expect(groups[0]).not.toHaveAttribute("open");
    expect(groups[1]).toHaveAttribute("open");
    expect(screen.getAllByText("3 summaries")).toHaveLength(2);
    expect(screen.getAllByText("Preparing the final handoff")).toHaveLength(3);
    expect(
      within(groups[1])
        .getAllByTestId("codex-reasoning-expanded-title")
        .map((node) => node.textContent),
    ).toEqual(["Addressing review feedback", "Planning validation coverage", "Preparing the final handoff"]);
  });

  it("documents a root-only main feed with exact child activity retained in the inspector", async () => {
    // This producer-shaped state exercises the real MessageFeed collector and
    // the inspector's independent canonical history path in one Playground fixture.
    useStore.getState().reset();
    render(<PlaygroundCodexSubagentStates />);

    const feed = within(screen.getByTestId("playground-codex-root-only-feed"));
    expect(feed.getByText("Show only the root agent's activity here.")).toBeInTheDocument();
    // Root reasoning summaries join the root activity group as thought lines.
    expect(feed.getByText("Thought, ran 2 commands")).toBeInTheDocument();
    expect(feed.getByText("2 Thought")).toBeInTheDocument();
    expect(
      feed
        .getAllByTestId("compact-tool-activity-line")
        .some((line) => line.textContent?.includes("Confirming root-only")),
    ).toBe(true);
    expect(feed.getAllByTestId("codex-live-terminal-chip")).toHaveLength(1);
    expect(feed.getByTestId("codex-live-terminal-chip")).toHaveTextContent("tail");
    expect(feed.queryByText("Child-only answer stays in the inspector.")).toBeNull();
    expect(feed.queryByText("Child-only reasoning")).toBeNull();
    expect(feed.queryByText("Checking child result")).toBeNull();
    expect(feed.queryByText("src/child-only.ts")).toBeNull();
    expect(feed.queryByText("child-only tool result")).toBeNull();
    expect(feed.queryByText("Child-only failure stays in the inspector.")).toBeNull();

    fireEvent.click(feed.getByTestId("feed-codex-subagents"));
    const inspector = await screen.findByTestId("codex-subagent-inspector");
    fireEvent.click(within(inspector).getByRole("button", { name: /schema_audit, Working, Transcript available/i }));

    expect(await within(inspector).findByText("Child-only answer stays in the inspector.")).toBeInTheDocument();
    // Child reasoning joins the child's activity group as thought lines, each opening to its full summary.
    expect(within(inspector).getByText("2 Thought")).toBeInTheDocument();
    // The child's answer follows that group, so it is collapsed to its heading until expanded.
    fireEvent.click(within(inspector).getByRole("button", { name: /^Show all \d+ tool calls/ }));
    fireEvent.click(within(inspector).getByRole("button", { name: "Show Thought: Child-only reasoning" }));
    fireEvent.click(within(inspector).getByRole("button", { name: "Show Thought: Checking child result" }));
    expect(within(inspector).getByText(/This official summary belongs in the inspector\./)).toBeInTheDocument();
    expect(
      within(inspector).getByText(/The exact child-owned result remains bounded and readable\./),
    ).toBeInTheDocument();
    expect(within(inspector).getByText("Child-only failure stays in the inspector.")).toHaveClass("text-cc-error");
    // The child Read is a line naming its file; opening it shows the result directly.
    fireEvent.click(within(inspector).getByRole("button", { name: "Show Read: src/child-only.ts" }));
    expect(within(inspector).getByText("child-only tool result")).toBeInTheDocument();
  });

  it("renders the real chat stack section with integrated chat components", () => {
    render(<Playground />);

    expect(screen.getByText("Component Playground")).toBeTruthy();
    const routedFinalSection = document.getElementById("overview-routed-answers");
    expect(routedFinalSection).toBeTruthy();
    const routedFinalStates = within(routedFinalSection!);
    const withToolsCard = routedFinalStates.getByTestId("playground-turn-summary-with-tools");
    expect(withToolsCard).toHaveClass("min-w-0", "max-w-[430px]", "overflow-hidden");
    const withTools = within(withToolsCard);
    expect(withTools.getByRole("button", { name: /Show turn activity.*2 tool/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    const groupedCoverage = withTools.getAllByTestId("thread-response-answer-count");
    expect(groupedCoverage).toHaveLength(2);
    expect(groupedCoverage[0]).toHaveTextContent("Answers 2 messages");
    expect(groupedCoverage[1]).toHaveTextContent("Answers 2 messages");
    expect(withTools.getByText(/detailed accepted-Work answer/)).toBeVisible();
    expect(withTools.getByText(/later answer adds the final mobile result/)).toBeVisible();
    fireEvent.click(groupedCoverage[0]!);
    const coveragePreview = screen.getByRole("dialog", { name: "Referenced user messages" });
    expect(coveragePreview).toHaveTextContent("Please foreground the polished result when this work is ready.");
    expect(coveragePreview).toHaveTextContent("Please include the mobile behavior too.");
    expect(withTools.getByRole("button", { name: /Show turn activity.*2 tool/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    fireEvent.click(groupedCoverage[0]!);
    expect(screen.queryByRole("dialog", { name: "Referenced user messages" })).not.toBeInTheDocument();
    expect(withTools.getAllByRole("button", { name: "Message options" })).toHaveLength(2);

    const withoutToolsCard = routedFinalStates.getByTestId("playground-turn-summary-without-tools");
    expect(withoutToolsCard).toHaveClass("min-w-0", "w-full", "max-w-[320px]", "overflow-hidden");
    const withoutTools = within(withoutToolsCard);
    expect(withoutTools.getByRole("button", { name: /Show turn activity/ })).toHaveAttribute("aria-expanded", "false");
    expect(withoutTools.getByTestId("thread-response-answer-count")).toHaveTextContent("Answers 1 message");
    expect(withoutTools.getByRole("button", { name: "Message options" })).toBeVisible();
    expect(withoutTools.queryByText(/tools?/i)).not.toBeInTheDocument();

    // A handed-off turn has no answer, so its collapsed view shows the last message instead of nothing.
    const handoff = within(routedFinalStates.getByTestId("playground-unanswered-handoff-turn"));
    expect(handoff.getByTestId("thread-response-unanswered-message")).toHaveTextContent(/I'll follow the fix there/);
    expect(handoff.queryByTestId("thread-response-current")).not.toBeInTheDocument();

    // An answer from another thread joins its thread link and answer chip in one header tag.
    const crossThreadHeader = within(routedFinalStates.getByTestId("playground-cross-thread-answer")).getByTestId(
      "message-thread-header",
    );
    expect(within(crossThreadHeader).getByTestId("thread-source-badge")).toHaveTextContent("thread:q-2043");
    expect(within(crossThreadHeader).getByTestId("thread-response-answer-count")).toHaveTextContent(
      "Answers 1 message",
    );

    const associatedMainCard = routedFinalStates.getByTestId("playground-associated-main-answer");
    expect(associatedMainCard).toHaveClass("min-w-0", "w-full", "max-w-[430px]", "overflow-hidden");
    const associatedMain = within(associatedMainCard);
    expect(associatedMain.getByTestId("thread-response-answer-count")).toHaveTextContent("Answers 1 message");
    expect(associatedMain.getByTestId("thread-source-badge")).toHaveTextContent("thread:main");
    expect(associatedMain.getByRole("button", { name: /Show turn activity.*1 tool/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(associatedMainCard.querySelectorAll('[data-message-id="playground-associated-main-answer"]')).toHaveLength(
      1,
    );

    const expandedCard = routedFinalStates.getByTestId("playground-turn-summary-expanded");
    expect(expandedCard).toHaveClass("min-w-0", "max-w-[430px]");
    const expanded = within(expandedCard);
    expect(expanded.getByRole("button", { name: /Hide turn activity/ })).toHaveAttribute("aria-expanded", "true");
    const expandedCoverage = expanded.getByTestId("thread-response-answer-count");
    expect(expandedCoverage).toHaveTextContent("Answers 2 messages");
    fireEvent.click(expandedCoverage);
    expect(screen.getByRole("dialog", { name: "Referenced user messages" })).toHaveTextContent(
      "Please include the mobile behavior too.",
    );
    expect(expanded.getByRole("button", { name: /Hide turn activity/ })).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(expandedCoverage);
    const expandedCurrent = expanded
      .getByText("The later answer adds the final mobile result without compressing the detailed answer above it.")
      .closest<HTMLElement>("[data-testid='thread-response-current-expanded']")!;
    expect(expandedCurrent).toBeInTheDocument();
    expect(within(expandedCurrent).getByRole("button", { name: "Message options" })).toBeVisible();
    const expandedMessageRow = within(expandedCurrent)
      .getByTestId("markdown")
      .closest<HTMLElement>("[class~='group/msg']")!;
    expect(expandedMessageRow).toBeInTheDocument();
    expect(expandedMessageRow).not.toHaveClass("gap-2", "sm:gap-3");
    expect(expandedMessageRow.children).toHaveLength(1);

    const sharedAnswer = within(routedFinalStates.getByTestId("playground-multi-owner-answer"));
    const sharedCoverage = sharedAnswer.getByTestId("thread-response-answer-count");
    expect(sharedCoverage).toHaveTextContent("Answers 2 messages");
    fireEvent.click(sharedCoverage);
    expect(screen.getByRole("dialog", { name: "Referenced user messages" })).toHaveTextContent(
      "Please handle my Main request.",
    );
    expect(screen.getByRole("dialog", { name: "Referenced user messages" })).toHaveTextContent(
      "Please include this quest's request in the same answer.",
    );
    fireEvent.click(sharedCoverage);
    // The pinned decision fixture reuses both answers but renders its source
    // Quiz only once beside the retained prompt and notification.
    const pinnedDecision = within(routedFinalStates.getByTestId("playground-pinned-quiz-source"));
    expect(pinnedDecision.getAllByTestId("thread-response-answer-count")).toHaveLength(2);
    expect(pinnedDecision.getAllByRole("region", { name: "Quest quiz" })).toHaveLength(1);
    expect(pinnedDecision.getByText("Choose whether the follow-up should remain parked.")).toBeVisible();
    expect(pinnedDecision.getByText("Choose the follow-up boundary")).toBeVisible();
    // Each recurring firing keeps its own report and exact firing reference,
    // even though both previews name the same recurring timer schedule.
    const timerReports = within(routedFinalStates.getByTestId("playground-timer-answer-reports"));
    expect(
      timerReports.getByText("The scheduled build checks passed. The release candidate is ready for its review."),
    ).toBeVisible();
    expect(
      timerReports.getByText("The next scheduled check found one new test failure in the release candidate."),
    ).toBeVisible();
    const timerCoverage = timerReports.getAllByTestId("thread-response-answer-count");
    expect(timerCoverage).toHaveLength(2);
    for (const [index, badge] of timerCoverage.entries()) {
      expect(badge).toHaveTextContent("Answers 1 message");
      fireEvent.click(badge);
      const preview = screen.getByRole("dialog", { name: "Referenced user messages" });
      expect(within(preview).getByText(`timer-m${index + 1}`)).toBeVisible();
      expect(preview).toHaveTextContent("[⏰ Timer t2 reminder] Check build health");
      fireEvent.click(badge);
    }
    // A request sent only as a comment keeps a previewable answer label showing the comment.
    const commentOnly = within(routedFinalStates.getByTestId("playground-comment-only-answer"));
    const commentBadge = commentOnly.getByTestId("thread-response-answer-count");
    fireEvent.click(commentBadge);
    expect(
      within(screen.getByRole("dialog", { name: "Referenced user messages" })).getByTestId(
        "thread-response-covered-message-comment",
      ),
    ).toHaveTextContent("Also is this something we can properly fix?");
    fireEvent.click(commentBadge);
    expect(routedFinalStates.getAllByTestId("thread-response-answer-count")).toHaveLength(12);
    expect(routedFinalStates.queryByText("Current answer")).not.toBeInTheDocument();
    expect(routedFinalStates.queryByText("Leader activity")).not.toBeInTheDocument();
    const scrollIntoView = vi.mocked(Element.prototype.scrollIntoView);
    scrollIntoView.mockClear();
    // Role queries are scoped to the navigation or owning section: a document-wide
    // accessible-name query over the full Playground took ~16s on its own.
    const navigation = within(document.querySelector<HTMLElement>("aside")!);
    fireEvent.click(navigation.getByRole("button", { name: "Routed Answers" }));
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "smooth" });
    const inlineQuestPreview = getPlaygroundSectionByTitle("Inline Quest Preview");
    expect(inlineQuestPreview.getByRole("heading", { name: "Inline Quest Preview" })).toBeTruthy();
    expect(inlineQuestPreview.getByRole("button", { name: "Show idle state" })).toHaveAttribute("aria-pressed", "true");
    expect(navigation.getByRole("button", { name: "Inline Quest Preview" })).toBeTruthy();
    expect(screen.getByText("Real Chat Stack")).toBeTruthy();
    const leaderSessionReturn = getPlaygroundSectionByTitle("Leader Session Return Stability");
    expect(leaderSessionReturn.getByRole("button", { name: "Show activity chip" })).toBeTruthy();
    expect(leaderSessionReturn.getByRole("button", { name: "Show thread status" })).toBeTruthy();
    expect(leaderSessionReturn.getByRole("button", { name: "Show both status chips" })).toBeTruthy();
    expect(leaderSessionReturn.getByRole("button", { name: "Show needs-input pill" })).toBeTruthy();
    expect(screen.getByTestId("playground-leader-session-return")).toBeTruthy();
    expect(screen.getByText("Shortcut Hints")).toBeTruthy();
    expect(screen.getByText("Timer Messages")).toBeTruthy();
    expect(screen.getByText("Grouped repeated error cards")).toBeTruthy();
    expect(screen.getByText("Same error happened 8 times")).toBeTruthy();
    expect(screen.getByTestId("playground-grouped-repeated-error-feed")).toHaveClass("h-[360px]");

    const repeatedErrorText =
      "Error: stream disconnected before completion: error sending request for url (http://localhost:4000/responses)";
    expect(screen.getAllByText(repeatedErrorText)).toHaveLength(2);
    expect(screen.getByText("Session restored after operator intervention")).toBeTruthy();

    const realChat = screen.getByTestId("playground-real-chat-stack");
    expect(realChat).toBeTruthy();
    expect(screen.getByTestId("playground-mobile-feed-width")).toBeTruthy();

    // Dynamic tool permission should be visible inside the integrated ChatView.
    expect(within(realChat).getByText("dynamic:code_interpreter")).toBeTruthy();

    expect(within(realChat).getByText("Thread routing reminder")).toBeTruthy();
    expect(within(realChat).getByText("model-only")).toBeTruthy();
    expect(within(realChat).queryByText(/Missing thread marker/)).toBeNull();

    fireEvent.click(within(realChat).getByRole("button", { name: "Expand Thread routing reminder" }));
    expect(within(realChat).getByText(/^\[Thread routing reminder\]/)).toBeTruthy();
  });

  it("documents the live full-block and partial chat selection controls", () => {
    // The fixture mirrors the failing and working screenshots with the real hook
    // and menu, so browser validation can exercise element-boundary selections.
    render(<PlaygroundSelectionContextMenu />);

    expect(screen.getByTestId("playground-full-block-selection")).toBeTruthy();
    expect(screen.getByTestId("playground-full-block-selection-source").textContent).toContain(
      "The leader conflated three visually similar boundaries",
    );
    expect(screen.getByText(/Select the complete paragraph and list/)).toBeTruthy();
    expect(screen.getByTestId("playground-full-block-selection-quote").textContent).toBe(
      "Quoted selection appears here.",
    );
  });

  it("documents first-line Side Chat action controls and fallback reason states", () => {
    render(<Playground />);

    expect(screen.getByText("Desktop hover first-line native menu")).toBeTruthy();
    expect(screen.getByText("Keyboard focus first-line menu trigger")).toBeTruthy();
    expect(screen.getByText("Fallback reason and replay stay in menu")).toBeTruthy();
    expect(screen.getByText("Mobile touch first-line menu trigger")).toBeTruthy();
    expect(screen.getAllByText(/tiny action menu trigger sits at the end of the first line/i)).toHaveLength(2);
    expect(screen.getByText(/tiny touch trigger remains in the first line/i)).toBeTruthy();
    expect(screen.getByText(/Native fork unavailable: Codex native fork skipped/)).toBeTruthy();
    expect(screen.getByText("Replay Side Chat")).toBeTruthy();
    expect(screen.getByText("Confirm replay Side Chat")).toBeTruthy();
  });

  it("documents pending delegate trace states in Playground fixtures", () => {
    render(
      <>
        <PlaygroundDelegateTaskPendingNoHandoffGroup />
        <PlaygroundDelegateTaskPendingLiveActivityGroup />
      </>,
    );

    expect(screen.queryByText("Agent starting...")).toBeNull();
    for (const activitiesButton of screen.getAllByText("Activities")) {
      fireEvent.click(activitiesButton);
    }

    expect(
      screen.getByText(
        "Waiting for delegate handoff through end_delegation. No delegate activity has been recorded yet.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Delegate child is stopped or idle without an end_delegation handoff. Takode is keeping the trace inspectable while the parent waits for the bounded no-handoff path.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText("I cannot know the exact fork-memory sentinel from inherited context. I used no tools."),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open raw delegate transcript: del_waiting123" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open raw delegate transcript: del_live123" })).toBeTruthy();
  });

  it("keeps the missing Side Chat child-message snapshot stable across unrelated store updates", () => {
    // Missing child-session messages are a normal Playground state. The selector
    // fallback must be referentially stable so unrelated fixture updates, such as
    // seeding notification rows, do not trigger React's external-store loop guard.
    useStore.getState().reset();
    render(<PlaygroundSideChatStates />);

    expect(screen.getByText("Open read-only Side Chat panel")).toBeTruthy();

    act(() => {
      useStore.setState({ sessionNotifications: new Map([["unrelated-session", []]]) });
    });

    expect(screen.getByText("Open read-only Side Chat panel")).toBeTruthy();
  });

  it("shows the voice mode selector before the recording label in Playground composer states", () => {
    // Render the whole catalog, but avoid resolving labels for unrelated controls.
    // jsdom scans the document for each control's labels, making global queries quadratic.
    render(<Playground />);
    const composer = getPlaygroundSection("states-composer-voice-recording");

    expect(composer.queryByLabelText("Current input level")).toBeNull();
    expect(composer.queryByLabelText("Recent input level history")).toBeNull();
    expect(composer.getAllByLabelText("Current and recent input level").length).toBeGreaterThanOrEqual(3);

    const editRow = composer.getByTestId("playground-recording-mode-row-edit");
    const editToggle = within(editRow).getByTestId("playground-recording-mode-toggle-edit");
    const editRecordingLabel = within(editRow).getByText("Recording");
    expect(editToggle.compareDocumentPosition(editRecordingLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(editRow).getByLabelText("Current and recent input level")).toBeTruthy();

    const appendRow = composer.getByTestId("playground-recording-mode-row-append");
    const appendToggle = within(appendRow).getByTestId("playground-recording-mode-toggle-append");
    const appendRecordingLabel = within(appendRow).getByText("Recording");
    expect(appendToggle.compareDocumentPosition(appendRecordingLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(appendRow).getByLabelText("Current and recent input level")).toBeTruthy();
    expect(composer.getByText("Rerun as append")).toBeTruthy();
    expect(composer.getByText("Rerun as voice edit")).toBeTruthy();
    expect(composer.getByText("Rerunning as voice edit...")).toBeTruthy();
    expect(composer.getAllByLabelText("Dismiss alternate voice rerun offer")).toHaveLength(2);
    expect(composer.getAllByTestId("alternate-voice-rerun-offer")).toHaveLength(2);
  });

  it("documents Composer backend-native permission selector states", () => {
    // Keep accessible-name assertions within their actual Composer fixtures.
    render(<Playground />);
    const composer = getPlaygroundSection("interactive-composer");

    expect(composer.getByText("Claude permission selector menu")).toBeTruthy();
    expect(composer.getByText("Codex permission change confirmation")).toBeTruthy();
    // The normal Claude menu offers only the current modes; a retired saved mode
    // (Don't ask) appears only in the fixture where it is the session's value.
    expect(composer.getByText("Claude permission menu with a retired saved mode")).toBeTruthy();
    const [claudeMenu, retiredModeMenu] = composer.getAllByTestId("composer-permission-mode-menu");
    expect(claudeMenu).toHaveTextContent("Auto");
    expect(claudeMenu).toHaveTextContent("Full access");
    expect(claudeMenu).not.toHaveTextContent("Delegate");
    expect(claudeMenu).not.toHaveTextContent("Don't ask");
    expect(retiredModeMenu).toHaveTextContent("Don't ask");
    expect(composer.getByTestId("composer-permission-mode-popover")).toHaveTextContent(
      "Change permissions to Full access?",
    );
    expect(composer.getByText("Claude model and effort selector")).toBeTruthy();
    expect(composer.getByText("Codex model and effort selector")).toBeTruthy();
    expect(composer.getByText("Codex model selector — narrow layout")).toBeTruthy();
    expect(composer.getByRole("button", { name: "Model and effort: opus-5.5 Extra high" })).toBeTruthy();
    expect(composer.getAllByRole("button", { name: "Model and effort: 5.6 Sol Ultra" }).length).toBeGreaterThan(0);
    // Claude's open menu has Model and Effort only; Speed and Reset are Codex-only rows.
    const [claudeSummary, codexSummary] = composer.getAllByTestId("composer-model-summary-menu");
    expect(claudeSummary).toHaveTextContent("Effort");
    expect(claudeSummary).toHaveTextContent("Extra high");
    expect(claudeSummary).not.toHaveTextContent("Speed");
    expect(claudeSummary).not.toHaveTextContent("Reset to default");
    expect(codexSummary).toHaveTextContent("Model");
    expect(codexSummary).toHaveTextContent("Effort");
    expect(codexSummary).not.toHaveTextContent("Effective");
    expect(codexSummary).toHaveTextContent("Speed");
    expect(codexSummary).toHaveTextContent("Reset to default");
    expect(composer.getByTestId("composer-reasoning-warning")).toHaveTextContent(
      "Runtime is using High instead of Ultra.",
    );
  });

  it("documents the quest commit diff slot with a flush sticky file header", () => {
    render(<PlaygroundDiffViewerSection />);

    const diffSlot = screen.getByTestId("playground-quest-commit-diff-slot");
    const loadingSlot = screen.getByTestId("playground-quest-commit-loading-slot");
    const diffContent = diffSlot.querySelector(".quest-commit-diff-content");
    expect(diffSlot).toHaveClass("h-64", "min-h-0", "pt-0", "px-4", "pb-4");
    expect(loadingSlot).toHaveClass("h-64", "min-h-0", "pt-0", "px-4", "pb-4");
    expect(within(loadingSlot).getByText("Loading commit diff...")).toBeTruthy();
    expect(diffContent?.firstElementChild).toHaveClass("diff-viewer");
    expect(within(diffSlot).getAllByRole("button", { name: "Collapse file" })).toHaveLength(2);
    const aggregate = screen.getByLabelText("Overall changes: 3 additions, 1 deletions");
    expect(aggregate).toBeTruthy();
    expect(aggregate).not.toHaveTextContent("Overall");
    expect(screen.getByLabelText("Code changes: 2 additions, 1 deletions")).toBeTruthy();
    expect(screen.getByLabelText("Tests changes: 1 additions, 0 deletions")).toBeTruthy();
    expect(screen.getByTestId("playground-quest-commit-diff-stats")).not.toHaveTextContent("Overall");
    const codeOnlyStats = screen.getByTestId("playground-code-only-stats");
    expect(within(codeOnlyStats).getByLabelText("Code changes: 7 additions, 0 deletions")).toBeTruthy();
    expect(within(codeOnlyStats).queryByLabelText(/^Tests changes:/)).toBeNull();
    expect([...diffSlot.querySelectorAll<HTMLElement>(".diff-file-header")].map((header) => header.title)).toEqual([
      "web/server/quest-cli-memory-commit-flags.ts",
      "web/server/quest-cli-memory-commit-flags.test.ts",
    ]);
  });

  it("documents waiting counts in the lightweight herd summary mock", () => {
    // This covers the Playground mock state without rendering the full
    // Playground page, which is intentionally heavy and can make a tiny
    // count-cluster assertion too slow in the full suite.
    render(<PlaygroundHerdSummaryBar isExpanded={false} />);

    expect(screen.getAllByLabelText("1 session waiting on timers, background jobs or queues").length).toBeGreaterThan(
      0,
    );
  });
});
