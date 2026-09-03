// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { TurnCollapseBar } from "./TurnActivitySummary.js";

const STATS = { messageCount: 1, toolCount: 3, subagentCount: 0, herdEventCount: 0 };

describe("TurnActivitySummary root-only tool scope", () => {
  it("keeps expanded summaries on the same root-only count contract", () => {
    render(<TurnCollapseBar stats={STATS} durationMs={null} onClick={() => {}} />);

    expect(screen.getByRole("button", { name: "Collapse turn from top" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button")).toHaveTextContent("1 message·3 tools");
    expect(screen.getByRole("button")).not.toHaveAccessibleName(/nested Codex subagent activity/i);
  });

  it("uses count-only copy for a single lifecycle worker event in the top shortcut", () => {
    render(
      <TurnCollapseBar
        stats={{
          messageCount: 0,
          toolCount: 0,
          subagentCount: 0,
          herdEventCount: 1,
          herdEventLifecycle: ["failed"],
        }}
        durationMs={null}
        onClick={() => {}}
      />,
    );

    expect(screen.getByRole("button")).toHaveTextContent("1 worker event");
    expect(screen.getByRole("button")).not.toHaveTextContent(/Work failed/);
  });

  it("keeps uncommon herd lifecycle detail out of collapsed activity summaries", () => {
    render(
      <TurnCollapseBar
        stats={{
          messageCount: 0,
          toolCount: 0,
          subagentCount: 0,
          herdEventCount: 2,
          herdEventLifecycle: ["context_continued", "interrupted"],
        }}
        durationMs={null}
        onClick={() => {}}
      />,
    );

    expect(screen.getByRole("button")).toHaveTextContent("2 worker events");
    expect(screen.getByRole("button")).not.toHaveTextContent(/Work interrupted|context compacted/);
  });
});
