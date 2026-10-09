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
import { PLAYGROUND_RECOVERY_MODEL_DELIVERY_CONTENT } from "./playground/CodexRecoveryPlaygroundMessages.js";
import { PLAYGROUND_AUTO_PAUSE_RECOVERY_ENTRY } from "./playground/AutoPausePlaygroundStates.js";
import { MOCK_SESSION_ID, PLAYGROUND_TURN_RECOVERY_ACTION_SESSION_ID } from "./playground/fixtures.js";
import { useStore } from "../store.js";
import { installPlaygroundTestEnvironment, PlaygroundRecoveryStatesOnly } from "./Playground.test-helpers.js";

// Playground tests are split across Playground*.test.tsx files so the heavy full-catalog
// renders run in parallel workers. This file: recovery, navigation and leader-routing Playground fixtures.
installPlaygroundTestEnvironment();

// A full-catalog render costs about 4-8 s of CPU on its own, so several concurrent
// suite runs need more than the default 10 s; tests with larger needs set their own.
describe("Playground", { timeout: 30_000 }, () => {
  it("documents paused recovery guidance and completed terminal receipts", () => {
    // Message-related lifecycle states must remain inspectable without a live server or backend.
    render(<Playground />);

    expect(screen.getByText("Held inputs — waiting for session recovery")).toBeTruthy();
    expect(screen.getByText("Held inputs — release accepted")).toBeTruthy();
    expect(screen.getByText("Held inputs — checking current message")).toBeTruthy();
    expect(screen.getByText("Held inputs — current message running")).toBeTruthy();
    expect(screen.getByText("Held inputs — choose another model")).toBeTruthy();
    expect(screen.getByText("Held inputs — Copilot sign-in required")).toBeTruthy();
    expect(screen.getByText("Reconnecting (2 of 5)")).toBeTruthy();
    expect(screen.getByText("Retrying message (attempt 4)")).toBeTruthy();
    expect(screen.getByTestId("playground-codex-stream-retry")).toHaveTextContent("Retrying response...");
    expect(screen.getByTestId("playground-claude-network-wait")).toHaveTextContent("Waiting for connection...");
    expect(screen.getByTestId("playground-claude-network-wait-paused")).toHaveTextContent("Waiting for connection...");
    expect(screen.getAllByText(/Cause: Copilot sign-in failed at/)).toHaveLength(1);
    expect(screen.getAllByText(/Cause: The model connection dropped repeatedly at/)).toHaveLength(4);
    expect(screen.getByText(/Cause: The selected model is not available at/)).toBeTruthy();
    expect(
      screen.getByText(
        "Takode is checking this session with your current message. Held inputs will send if it finishes successfully.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Your current message is running. Held automatic inputs will send when it finishes successfully.",
      ),
    ).toBeTruthy();
    expect(screen.getByTestId("playground-auto-pause-idle-mobile-width").className).toContain("max-w-[320px]");
    expect(screen.getByTestId("playground-auto-pause-releasing-mobile-width").className).toContain("max-w-[320px]");
    expect(screen.getByTestId("playground-auto-pause-mobile-width").className).toContain("max-w-[320px]");
    expect(screen.getByTestId("playground-auto-pause-active-mobile-width").className).toContain("max-w-[320px]");
    expect(screen.getByTestId("playground-auto-pause-action-required-mobile-width").className).toContain(
      "max-w-[320px]",
    );
    for (const stateId of ["idle", "releasing", "testing", "active", "unsupported-model", "failed-held"]) {
      const state = within(screen.getByTestId(`playground-auto-pause-${stateId}`));
      const banner = state.getByTestId("composer-paused-banner");
      expect(banner.className).toContain("border-cc-attention/75");
      expect(banner.className).toContain("bg-cc-attention-bg");
      expect(state.getByTestId("composer-paused-chip").className).toContain("text-cc-attention-strong");
      expect(state.getByTestId("composer-auto-pause-guidance").className).toContain("text-cc-fg");
      expect(state.getByTestId("composer-auto-pause-release")).toBeTruthy();
    }
    const idleRelease = within(screen.getByTestId("playground-auto-pause-idle")).getByTestId(
      "composer-auto-pause-release",
    );
    expect(idleRelease).toHaveTextContent("Release now");
    expect(idleRelease).not.toBeDisabled();
    expect(idleRelease.className).toContain("min-h-8");
    expect(idleRelease.className).toContain("shrink-0");
    expect(idleRelease.parentElement?.className).toContain("flex-wrap");
    const releasing = within(screen.getByTestId("playground-auto-pause-releasing"));
    expect(releasing.getByTestId("composer-auto-pause-release")).toHaveTextContent("Releasing…");
    expect(releasing.getByTestId("composer-auto-pause-release")).toBeDisabled();
    expect(releasing.getByTestId("composer-auto-pause-guidance")).toHaveTextContent(
      "Takode accepted your request and is releasing the held inputs.",
    );
    expect(document.body.textContent).not.toContain("PRIVATE RAW PROVIDER ERROR");
    expect(document.body.textContent).not.toContain("PRIVATE HELD HERD PAYLOAD");
    expect(document.body.textContent).not.toContain("PRIVATE TRUSTED ROUTE LABEL");
    const realChat = within(screen.getByTestId("playground-real-chat-stack"));
    expect(realChat.getByRole("region", { name: "Automatic input recovery summary" })).toBeTruthy();
    expect(realChat.getByText("Herd Events · turn_end")).toBeTruthy();
    expect(realChat.getByText("Herd Events · board_stalled")).toBeTruthy();

    const lifecycleCard = screen.getByText("Lifecycle summaries in a worker-event group").closest(".border");
    expect(lifecycleCard).toBeTruthy();
    const lifecycle = within(lifecycleCard as HTMLElement);
    expect(lifecycle.getByText("4 worker events")).toBeTruthy();
    // The rolling window shows the newest three events by header summary and folds the oldest.
    expect(lifecycle.getByTestId("compact-tool-activity-earlier")).toHaveTextContent("+1 earlier");
    expect(lifecycle.getAllByTestId("compact-tool-activity-line")).toHaveLength(3);

    fireEvent.click(lifecycle.getByRole("button", { name: "Show all 4 activity items: 4 worker events" }));
    expect(lifecycle.getAllByTestId("compact-tool-activity-line")).toHaveLength(4);
    expect(lifecycle.getByText(/waiting for decision; Work preserved/)).toBeTruthy();
    expect(lifecycle.getByText(/same Work resumed after decision wait/)).toBeTruthy();
    expect(lifecycle.getByText(/context compacted; same Work continued/)).toBeTruthy();
    expect(lifecycle.getByText(/Work interrupted/)).toBeTruthy();
  });

  it("documents active Codex recovery progress and the audit-only terminal state", () => {
    // Current recovery progress stays inspectable, while terminal state remains
    // in server/audit authority without recreating the retired attention chip.
    // A queued follow-up remains visible while the session is idle.
    vi.useFakeTimers();
    render(<PlaygroundRecoveryStatesOnly />);
    act(() => vi.advanceTimersByTime(1_000));

    const states = [
      {
        testId: "playground-codex-turn-recovery-recovering",
        label: "Reconnecting interrupted work",
        detail: "reconnecting this session so it can finish the interrupted work",
      },
      {
        testId: "playground-codex-turn-recovery-replay",
        label: "Retrying interrupted input",
        detail: "proved the original input never entered Codex history and is replaying it once",
      },
      {
        testId: "playground-codex-turn-recovery-continuation-pending",
        label: "Interrupted-work check queued",
        detail: "queued one follow-up to inspect prior work before finishing what is missing",
      },
      {
        testId: "playground-codex-turn-recovery-continuation-active",
        label: "Finishing interrupted response",
        detail: "finishing the interrupted response",
      },
    ];

    for (const state of states) {
      const preview = within(screen.getByTestId(state.testId));
      const chip = preview.getByTestId("codex-turn-recovery-chip");
      expect(chip).toHaveTextContent(state.label);
      fireEvent.click(chip);
      const detailId = chip.getAttribute("aria-controls");
      const detail = detailId ? document.getElementById(detailId) : null;
      expect(detail).toHaveTextContent(state.detail);
      expect(detail).toHaveTextContent("Work to check: q-9010");
      fireEvent.click(chip);
    }

    const terminalElement = screen.getByTestId("playground-codex-turn-recovery-action-required");
    const terminal = within(terminalElement);
    expect(useStore.getState().sessionStatus.get(PLAYGROUND_TURN_RECOVERY_ACTION_SESSION_ID)).toBe("idle");
    expect(terminal.getByText("Pending delivery")).toBeInTheDocument();
    expect(terminal.getByText("Check whether the settings change still needs follow-up.")).toBeInTheDocument();
    expect(terminalElement.querySelector('[data-feed-activity-row="true"]')).toBeNull();
    expect(terminal.queryByTestId("codex-turn-recovery-chip")).toBeNull();
    expect(terminal.queryByTestId("codex-turn-recovery-detail")).toBeNull();
    expect(terminal.queryByRole("button", { name: "Open affected thread" })).toBeNull();
    expect(terminal.queryByRole("button", { name: "Work is complete" })).toBeNull();
    expect(terminal.getByText(/verified the already-completed side effects/)).toBeInTheDocument();

    const recoveryEventChip = terminal.getByRole("button", { name: "Expand Resuming Interrupted Work" });
    expect(recoveryEventChip).toHaveAttribute("aria-expanded", "false");
    expect(terminal.queryByText(/persisted observations; they may be incomplete/)).toBeNull();
    fireEvent.click(recoveryEventChip);
    const recoveryEventDetail = terminal.getByRole("region", { name: "Resuming Interrupted Work details" });
    expect(recoveryEventDetail).toHaveTextContent(/does not by itself prove Codex received or completed/);
    expect(recoveryEventDetail).toHaveTextContent(
      `Message size: ${PLAYGROUND_RECOVERY_MODEL_DELIVERY_CONTENT.length.toLocaleString()} characters`,
    );
    expect(within(recoveryEventDetail).getByTestId("markdown").textContent).toBe(
      PLAYGROUND_RECOVERY_MODEL_DELIVERY_CONTENT,
    );

    const diagnosticChip = terminal.getByRole("button", { name: "Expand Why Automatic Retry Stopped" });
    expect(diagnosticChip).not.toHaveClass("border-cc-attention/55");
    expect(terminal.queryByText(/otherwise no action is required/)).toBeNull();
    fireEvent.click(diagnosticChip);
    const diagnosticDetail = terminal.getByRole("region", { name: "Why Automatic Retry Stopped details" });
    const diagnosticText = within(diagnosticDetail).getByTestId("markdown").textContent ?? "";
    expect(diagnosticText).toContain("Send a new instruction in this thread only if");
    expect(diagnosticText).toContain("otherwise no action is required");
    expect(terminal.queryByText(/Check interrupted work/)).toBeNull();
    expect(terminal.queryByText(/Work is complete/)).toBeNull();
  });

  it("renders real ChatView and MessageFeed recovery fixtures without a socket", () => {
    // Producer-shaped Playground state must remain renderable when there is no
    // authoritative transport. The incomplete readiness static reproduces the
    // isolated Execute environment that previously dereferenced socket.send.
    vi.stubGlobal(
      "WebSocket",
      class DisconnectedPlaygroundWebSocket {
        static OPEN = undefined;
      },
    );

    render(<Playground />);

    const realChatElement = screen.getByTestId("playground-real-chat-stack");
    const realChat = within(realChatElement);
    expect(realChatElement).toBeInTheDocument();
    expect(screen.getByTestId("playground-mobile-feed-width")).toBeInTheDocument();
    expect(realChat.getByRole("region", { name: "Automatic input recovery summary" })).toBeTruthy();
    expect(realChat.getByText("Herd Events · turn_end")).toBeTruthy();
    expect(realChat.getByText("Herd Events · board_stalled")).toBeTruthy();
    const seededRecovery = useStore
      .getState()
      .messages.get(MOCK_SESSION_ID)
      ?.find((message) => message.id === PLAYGROUND_AUTO_PAUSE_RECOVERY_ENTRY.id);
    expect(seededRecovery).toMatchObject({
      id: PLAYGROUND_AUTO_PAUSE_RECOVERY_ENTRY.id,
      metadata: { codexAutoPauseRecoverySummary: PLAYGROUND_AUTO_PAUSE_RECOVERY_ENTRY.recovery },
    });

    const olderSectionButton = realChat.getByRole("button", { name: "Load older section" });
    expect(olderSectionButton).toBeTruthy();
    fireEvent.click(olderSectionButton);

    // Explicit progress invariant: the disconnected action returns, the tree
    // stays mounted without fake loading, and the normalized row remains singular.
    const realChatAfterHistoryElement = screen.getByTestId("playground-real-chat-stack");
    expect(realChatAfterHistoryElement).toBeInTheDocument();
    const realChatAfterHistory = within(realChatAfterHistoryElement);
    expect(realChatAfterHistory.getByTestId("message-feed-overlay")).toBeInTheDocument();
    expect(realChatAfterHistory.queryByText("Loading older section...")).not.toBeInTheDocument();
    expect(realChatAfterHistory.getByRole("button", { name: "Load older section" })).toBeInTheDocument();
    expect(realChatAfterHistory.getAllByTestId("codex-auto-pause-recovery-summary")).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "A runtime error occurred" })).not.toBeInTheDocument();

    const questThreadFeed = within(screen.getByTestId("playground-quest-thread-projection"));
    const olderThreadButton = questThreadFeed.getByRole("button", { name: "Load older section" });
    fireEvent.click(olderThreadButton);

    const questThreadAfterActionElement = screen.getByTestId("playground-quest-thread-projection");
    expect(questThreadAfterActionElement).toBeInTheDocument();
    const questThreadAfterAction = within(questThreadAfterActionElement);
    expect(questThreadAfterAction.getByTestId("message-feed-overlay")).toBeInTheDocument();
    expect(questThreadAfterAction.queryByText("Loading older section...")).not.toBeInTheDocument();
    expect(questThreadAfterAction.getByRole("button", { name: "Load older section" })).toBeInTheDocument();

    const realChatAfterThreadAction = within(screen.getByTestId("playground-real-chat-stack"));
    expect(realChatAfterThreadAction.getByTestId("message-feed-overlay")).toBeInTheDocument();
    expect(realChatAfterThreadAction.getAllByTestId("codex-auto-pause-recovery-summary")).toHaveLength(1);
    expect(realChatAfterThreadAction.queryByText("Loading older section...")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "A runtime error occurred" })).not.toBeInTheDocument();
  });

  it("documents the mobile user-message navigator in its open touch overlay state", () => {
    render(<Playground />);

    expect(screen.getByText("Mobile touch selector with fixed solid overlay")).toBeTruthy();
    const openTouchSelector = screen
      .getAllByRole("dialog", { name: "User message selector" })
      .find((dialog) => dialog.parentElement === document.body && dialog.className.includes("fixed"));

    expect(openTouchSelector).toBeTruthy();
    expect(openTouchSelector?.className).toContain("bg-cc-card");
  });

  it("documents the labeled New Session modal layout", () => {
    render(<Playground />);

    const modal = screen.getByTestId("playground-new-session-modal-layout");
    expect(within(modal).getByText("Engine")).toBeTruthy();
    expect(within(modal).getByText("Permission mode")).toBeTruthy();
    expect(within(modal).getByText("Codex options")).toBeTruthy();
    expect(within(modal).getByText("Network access")).toBeTruthy();
    expect(within(modal).getByText("Workspace")).toBeTruthy();
    expect(within(modal).getByText("Runtime")).toBeTruthy();
    expect(within(modal).getByText("Model")).toBeTruthy();
    expect(within(modal).getByText("Default (gpt-5.5) ▾")).toBeTruthy();
  });

  it("documents leader thread routing and full Main activity", () => {
    render(<Playground />);

    expect(screen.getByText("Leader Main stream — full activity visible")).toBeTruthy();
    expect(screen.getByText("Leader thread switcher")).toBeTruthy();
    expect(screen.getByText("Checked worker state, inspected the board, and prepared the next dispatch.")).toBeTruthy();
    expect(
      screen.getByText(
        "Approved #70's plan for q-43. It's a clean unification: resize once at store time (1920px max).",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/@to\(user\)/)).toBeNull();
  });
});
