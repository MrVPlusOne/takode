// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import type { SessionAttentionRecord } from "../types.js";
import { AttentionLedgerRow } from "./AttentionLedgerRow.js";

function journeyRecord(overrides: Partial<SessionAttentionRecord>): SessionAttentionRecord {
  const type = overrides.type ?? "quest_journey_started";
  const finished = type === "quest_completed_recent";
  return {
    id: finished ? "finished" : "started",
    leaderSessionId: "leader-1",
    type,
    source: { kind: "board", id: "q-1033", questId: "q-1033", signature: type },
    questId: "q-1033",
    threadKey: "q-1033",
    title: finished ? "Journey finished" : "Journey started",
    summary: "Lifecycle card",
    actionLabel: "Open",
    priority: finished ? "review" : "created",
    state: finished ? "unresolved" : "resolved",
    createdAt: 120,
    updatedAt: 120,
    route: { threadKey: "q-1033", questId: "q-1033" },
    chipEligible: false,
    ledgerEligible: true,
    dedupeKey: finished ? "finished" : "started",
    ...overrides,
  };
}

describe("AttentionLedgerRow Journey lifecycle presentation", () => {
  it("keeps active Journey starts prominent", () => {
    render(<AttentionLedgerRow record={journeyRecord({ journeyLifecycleStatus: "active" })} sessionId="s1" />);

    const row = screen.getByTestId("attention-ledger-row");
    expect(row.getAttribute("data-journey-lifecycle-status")).toBe("active");
    expect(row.className).toContain("border-fuchsia-400/25");
  });

  it("keeps completed Journey starts quiet", () => {
    render(<AttentionLedgerRow record={journeyRecord({ journeyLifecycleStatus: "completed" })} sessionId="s1" />);

    const row = screen.getByTestId("attention-ledger-row");
    expect(row.getAttribute("data-journey-lifecycle-status")).toBe("completed");
    expect(row.className).toContain("border-cc-border/70");
    expect(row.className).toContain("bg-cc-card/35");
    expect(row.className).not.toContain("border-fuchsia-400/25");
    expect(row.className).not.toContain("bg-emerald-500/10");
  });

  it("renders Journey finished rows with completed-success treatment", () => {
    render(
      <AttentionLedgerRow
        record={journeyRecord({ type: "quest_completed_recent", journeyLifecycleStatus: "completed" })}
        sessionId="s1"
      />,
    );

    const row = screen.getByTestId("attention-ledger-row");
    expect(row.textContent).toContain("Journey finished");
    expect(row.className).toContain("border-emerald-400/30");
    expect(row.className).toContain("bg-emerald-500/10");
    expect(row.className).not.toContain("border-cc-border/70");
  });
});
