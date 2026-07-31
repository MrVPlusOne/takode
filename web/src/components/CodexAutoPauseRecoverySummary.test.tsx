// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCodexAutoPauseRecoverySearchText } from "../../server/codex-auto-pause-types.js";
import type { ChatMessage, CodexAutoPauseRecoveryOutcome, CodexAutoPauseRecoveryReceipt } from "../types.js";
import { MessageBubble } from "./MessageBubble.js";
import {
  buildPlaygroundAutoPauseRecoveryMessage,
  PLAYGROUND_AUTO_PAUSE_RECOVERY_ENTRY,
} from "./playground/AutoPausePlaygroundStates.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function summaryMessage(): ChatMessage {
  return buildPlaygroundAutoPauseRecoveryMessage();
}

const TERMINAL_OUTCOMES: CodexAutoPauseRecoveryOutcome[] = ["delivered", "suppressed", "discarded", "failed"];

function producerShapedSummaryMessage(receiptCount: number): ChatMessage {
  const now = Date.now();
  const receipts = Array.from({ length: receiptCount }, (_, index): CodexAutoPauseRecoveryReceipt => {
    const outcome = TERMINAL_OUTCOMES[index % TERMINAL_OUTCOMES.length]!;
    let reasonCode: CodexAutoPauseRecoveryReceipt["reasonCode"] = "delivery_pipeline_rejected";
    let reason = "Delivery pipeline rejected the released input without accepting ownership.";
    if (outcome === "delivered") {
      reasonCode = "codex_delivery_recovered";
      reason = "Accepted by Codex exactly once and completed after automatic turn recovery.";
    } else if (outcome === "suppressed") {
      reasonCode = "stale_board_state";
      reason = "Suppressed because the authoritative board state no longer matched the stalled event.";
    } else if (outcome === "discarded") {
      reasonCode = "explicit_cancel";
      reason = "Discarded after explicit cancellation before delivery could begin.";
    }
    return {
      groupId: `producer-recovery-group-${String(index + 1).padStart(3, "0")}`,
      source: "programmatic",
      sourceLabel: `Producer source ${String(index + 1).padStart(3, "0")}`,
      sourceDetail: index % 2 === 0 ? "turn_end" : "board_stalled",
      count: 1,
      coalescedCount: 0,
      queuedAt: now - 120_000 + index,
      lastQueuedAt: now - 100_000 + index,
      releasedAt: now - 60_000 + index,
      terminalAt: now - 59_000 + index,
      ...(outcome === "delivered" ? { completedAt: now - 15_000 + index, recovered: true } : {}),
      outcome,
      reasonCode,
      reason,
    };
  });
  const entry = structuredClone(PLAYGROUND_AUTO_PAUSE_RECOVERY_ENTRY);
  entry.timestamp = now;
  entry.content = `Automatic input recovery: ${receiptCount} terminal receipts.`;
  entry.recovery = {
    ...entry.recovery,
    updatedAt: now,
    status: "settled",
    receipts,
  };
  entry.searchText = buildCodexAutoPauseRecoverySearchText(entry.recovery);
  return buildPlaygroundAutoPauseRecoveryMessage(entry);
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

  it("reuses one locale formatter instead of rebuilding timestamp formatting for every receipt field", () => {
    // The live-open page performed repeated per-row toLocaleTimeString setup inside the measured Chrome task.
    const legacyPerCallFormatter = vi.spyOn(Date.prototype, "toLocaleTimeString");

    render(<MessageBubble message={summaryMessage()} showTimestamp={false} />);

    expect(legacyPerCallFormatter).not.toHaveBeenCalled();
  });

  it("keeps a producer-shaped 100-receipt summary collapsed until requested and pages every outcome", () => {
    // Large summaries must preserve every terminal receipt without eagerly mounting the 100-row long-task/card.
    render(<MessageBubble message={producerShapedSummaryMessage(100)} showTimestamp={false} />);

    const disclosure = screen.getByText("Inspect held input outcomes");
    const details = disclosure.closest("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(screen.queryByRole("list", { name: "Held input outcomes" })).toBeNull();
    expect(screen.queryAllByTestId(/^codex-auto-pause-receipt-/)).toHaveLength(0);
    expect(screen.getByText("100/100 settled")).toBeTruthy();

    fireEvent.click(disclosure);
    fireEvent(details, new Event("toggle", { bubbles: true }));

    const observedSources: string[] = [];
    const readPageSources = () => {
      const list = screen.getByRole("list", { name: "Held input outcomes" });
      const sources = Array.from(list.children).map(
        (row) => row.querySelector("div > span[title]")?.textContent?.trim() ?? "",
      );
      observedSources.push(...sources);
      return list;
    };
    const firstPage = readPageSources();
    expect(details.open).toBe(true);
    expect(firstPage.children).toHaveLength(10);
    expect(firstPage.className).toContain("max-h-96");
    expect(firstPage.className).toContain("overflow-y-auto");
    expect(screen.getByText("Outcomes 1–10 of 100")).toBeTruthy();
    expect(within(firstPage).getByText("Producer source 001 · turn_end")).toBeTruthy();
    expect(within(firstPage).getByText("Producer source 010 · board_stalled")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Previous outcome page" }).getAttribute("aria-disabled")).toBe("true");
    expect(screen.queryAllByTestId(/^codex-auto-pause-receipt-/)).toHaveLength(10);

    for (let page = 1; page < 10; page++) {
      fireEvent.click(screen.getByRole("button", { name: "Next outcome page" }));
      const start = page * 10 + 1;
      const end = start + 9;
      expect(screen.getByText(`Outcomes ${start}–${end} of 100`)).toBeTruthy();
      expect(readPageSources().children).toHaveLength(10);
      expect(screen.queryAllByTestId(/^codex-auto-pause-receipt-/)).toHaveLength(10);
    }

    expect(screen.getByText("Producer source 091 · turn_end")).toBeTruthy();
    expect(screen.getByText("Producer source 100 · board_stalled")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next outcome page" }).getAttribute("aria-disabled")).toBe("true");
    expect(observedSources).toEqual(
      Array.from({ length: 100 }, (_, index) => {
        const source = `Producer source ${String(index + 1).padStart(3, "0")}`;
        return `${source} · ${index % 2 === 0 ? "turn_end" : "board_stalled"}`;
      }),
    );
  });

  it("keeps native pagination focus attached through terminal and initial boundaries", async () => {
    // Boundary buttons remain native and focusable so reaching a disabled edge cannot drop keyboard focus to <body>.
    const user = userEvent.setup();
    render(<MessageBubble message={producerShapedSummaryMessage(100)} showTimestamp={false} />);

    const disclosure = screen.getByText("Inspect held input outcomes");
    const details = disclosure.closest("details") as HTMLDetailsElement;
    fireEvent.click(disclosure);
    fireEvent(details, new Event("toggle", { bubbles: true }));

    const previous = screen.getByRole("button", { name: "Previous outcome page" });
    const next = screen.getByRole("button", { name: "Next outcome page" });
    expect(previous.getAttribute("aria-disabled")).toBe("true");
    expect(previous.hasAttribute("disabled")).toBe(false);
    previous.focus();
    await user.keyboard("{Enter}");
    expect(document.activeElement).toBe(previous);
    expect(screen.getByText("Outcomes 1–10 of 100")).toBeTruthy();

    for (let page = 1; page < 9; page++) await user.click(next);
    expect(screen.getByText("Outcomes 81–90 of 100")).toBeTruthy();

    next.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByText("Outcomes 91–100 of 100")).toBeTruthy();
    expect(next.getAttribute("aria-disabled")).toBe("true");
    expect(next.hasAttribute("disabled")).toBe(false);
    expect(document.activeElement).toBe(next);
    expect(document.contains(document.activeElement)).toBe(true);

    await user.keyboard("{Enter}");
    expect(screen.getByText("Outcomes 91–100 of 100")).toBeTruthy();
    expect(document.activeElement).toBe(next);

    previous.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByText("Outcomes 81–90 of 100")).toBeTruthy();
    expect(document.activeElement).toBe(previous);

    for (let page = 8; page > 0; page--) await user.click(previous);
    expect(screen.getByText("Outcomes 1–10 of 100")).toBeTruthy();
    expect(previous.getAttribute("aria-disabled")).toBe("true");
    expect(previous.hasAttribute("disabled")).toBe(false);
    expect(document.activeElement).toBe(previous);
    expect(document.contains(document.activeElement)).toBe(true);
  });

  it("bounds a live 25-to-100 receipt update without closing accepted detail state", () => {
    // Execute updates an existing open summary; that path must never replace its 25-row page with all 100 rows.
    const view = render(<MessageBubble message={producerShapedSummaryMessage(25)} showTimestamp={false} />);
    const disclosure = screen.getByText("Inspect held input outcomes");
    const details = disclosure.closest("details") as HTMLDetailsElement;
    expect(details.open).toBe(true);
    expect(screen.queryAllByTestId(/^codex-auto-pause-receipt-/)).toHaveLength(25);
    expect(screen.queryByRole("navigation", { name: "Held input outcome pages" })).toBeNull();

    view.rerender(<MessageBubble message={producerShapedSummaryMessage(100)} showTimestamp={false} />);

    expect(details.open).toBe(true);
    expect(screen.getByText("Outcomes 1–10 of 100")).toBeTruthy();
    expect(screen.queryAllByTestId(/^codex-auto-pause-receipt-/)).toHaveLength(10);
    expect(screen.queryAllByTestId("codex-auto-pause-recovery-summary")).toHaveLength(1);
  });
});
