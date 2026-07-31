// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ChatMessage } from "../types.js";
import { MessageBubble } from "./MessageBubble.js";

afterEach(cleanup);

function summaryMessage(): ChatMessage {
  return {
    id: "recovery-summary",
    role: "system",
    content: "Automatic input recovery: 1 delivered, 1 suppressed.",
    timestamp: 300,
    variant: "info",
    metadata: {
      codexAutoPauseRecoverySummary: {
        family: "copilot_auth_refresh_exhausted",
        pausedAt: 100,
        recoveryConfirmedAt: 200,
        updatedAt: 300,
        status: "settled",
        receipts: [
          {
            groupId: "group-turn-end",
            source: "programmatic",
            sourceLabel: "Herd Events",
            sourceDetail: "turn_end",
            count: 2,
            coalescedCount: 1,
            survivingGroupId: "group-turn-end",
            queuedAt: 110,
            lastQueuedAt: 120,
            releasedAt: 200,
            terminalAt: 210,
            completedAt: 300,
            recovered: true,
            outcome: "delivered",
            reasonCode: "codex_delivery_recovered",
            reason: "Accepted by Codex exactly once and completed after automatic turn recovery.",
          },
          {
            groupId: "group-board-stalled",
            source: "programmatic",
            sourceLabel: "Herd Events",
            sourceDetail: "board_stalled",
            count: 1,
            coalescedCount: 0,
            queuedAt: 115,
            lastQueuedAt: 115,
            releasedAt: 200,
            terminalAt: 220,
            outcome: "suppressed",
            reasonCode: "stale_board_state",
            reason: "Suppressed because the authoritative board state no longer matched the stalled event.",
          },
        ],
      },
    },
  };
}

describe("CodexAutoPauseRecoverySummary", () => {
  it("renders accessible delivered/recovered and stale-suppressed terminal receipts", () => {
    // The original incident must remain understandable after the paused composer banner disappears.
    render(<MessageBubble message={summaryMessage()} showTimestamp={false} />);

    expect(screen.getByRole("region", { name: "Automatic input recovery summary" })).toBeTruthy();
    expect(screen.getByText("Automatic input recovery complete")).toBeTruthy();
    expect(screen.getByText("Herd Events · turn_end")).toBeTruthy();
    expect(screen.getByText("Herd Events · board_stalled")).toBeTruthy();
    expect(screen.getByText("Delivered")).toBeTruthy();
    expect(screen.getByText("Suppressed")).toBeTruthy();
    expect(
      screen.getByText("Accepted by Codex exactly once and completed after automatic turn recovery."),
    ).toBeTruthy();
    expect(
      screen.getByText("Suppressed because the authoritative board state no longer matched the stalled event."),
    ).toBeTruthy();
    expect(screen.getByText(/1 similar input was coalesced into representative/)).toBeTruthy();
    expect(screen.getByRole("list", { name: "Held input outcomes" }).children).toHaveLength(2);
  });

  it("re-renders the same summary row as asynchronous outcomes settle", () => {
    // A later authoritative update replaces the existing message instead of creating duplicate history cards.
    const message = summaryMessage();
    const summary = message.metadata!.codexAutoPauseRecoverySummary!;
    summary.status = "releasing";
    summary.receipts[1] = {
      ...summary.receipts[1]!,
      outcome: "released_to_delivery",
      reasonCode: "manual_recovery_succeeded",
      reason: "Manual recovery succeeded; queued for exact-once delivery.",
      terminalAt: undefined,
    };
    const view = render(<MessageBubble message={message} showTimestamp={false} />);
    expect(screen.getByText("Releasing held automatic inputs")).toBeTruthy();

    view.rerender(<MessageBubble message={summaryMessage()} showTimestamp={false} />);

    expect(screen.queryAllByTestId("codex-auto-pause-recovery-summary")).toHaveLength(1);
    expect(screen.getByText("Automatic input recovery complete")).toBeTruthy();
  });
});
