// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ChatMessage } from "../types.js";
import { MessageBubble } from "./MessageBubble.js";
import {
  buildPlaygroundAutoPauseRecoveryMessage,
  PLAYGROUND_AUTO_PAUSE_RECOVERY_ENTRY,
} from "./playground/AutoPausePlaygroundStates.js";

afterEach(cleanup);

function summaryMessage(): ChatMessage {
  return buildPlaygroundAutoPauseRecoveryMessage();
}

describe("CodexAutoPauseRecoverySummary", () => {
  it("builds the Playground card from a raw server entry through production normalization", () => {
    // This fails if the browser message contract or normalizer drifts away from the documented Playground state.
    const message = buildPlaygroundAutoPauseRecoveryMessage();
    expect(PLAYGROUND_AUTO_PAUSE_RECOVERY_ENTRY.type).toBe("codex_auto_pause_recovery_summary");
    expect(message).toMatchObject({
      id: PLAYGROUND_AUTO_PAUSE_RECOVERY_ENTRY.id,
      role: "system",
      historyIndex: 42,
      metadata: {
        threadKey: "q-42",
        questId: "q-42",
        codexAutoPauseRecoverySummary: PLAYGROUND_AUTO_PAUSE_RECOVERY_ENTRY.recovery,
      },
    });
  });

  it("renders accessible delivered/recovered and stale-suppressed terminal receipts", () => {
    // The original incident must remain understandable after the paused composer banner disappears.
    render(<MessageBubble message={summaryMessage()} showTimestamp={false} />);

    expect(screen.getByRole("region", { name: "Automatic input recovery summary" })).toBeTruthy();
    expect(screen.getByText("Automatic input recovery complete")).toBeTruthy();
    expect(screen.getByText("Herd Events · turn_end")).toBeTruthy();
    expect(screen.getByText("Herd Events · board_stalled")).toBeTruthy();
    expect(screen.getAllByText("Delivered")).toHaveLength(2);
    expect(screen.getByText("Suppressed")).toBeTruthy();
    expect(screen.getByText("Timer · turn_end")).toBeTruthy();
    expect(
      screen.getByText(
        "Delivered exactly once; the turn was interrupted or cancelled, so no completion or recovery was claimed.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText("Accepted by Codex exactly once and completed after automatic turn recovery."),
    ).toBeTruthy();
    expect(
      screen.getByText("Suppressed because the authoritative board state no longer matched the stalled event."),
    ).toBeTruthy();
    expect(screen.getByText(/1 similar input was coalesced into representative/)).toBeTruthy();
    expect(screen.getByRole("list", { name: "Held input outcomes" }).children).toHaveLength(3);
  });

  it("re-renders the same summary row as asynchronous outcomes settle", () => {
    // A later authoritative update replaces the existing message instead of creating duplicate history cards.
    const message = structuredClone(summaryMessage());
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
