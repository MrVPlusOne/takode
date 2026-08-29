// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { CollapsedActivityBar, TurnCollapseBar } from "./TurnActivitySummary.js";

const STATS = { messageCount: 1, toolCount: 3, subagentCount: 0, herdEventCount: 0 };

describe("TurnActivitySummary root-only tool scope", () => {
  it("describes only the tool rows present in the ordinary feed projection", () => {
    render(<CollapsedActivityBar stats={STATS} durationMs={null} leaderMode={false} onClick={() => {}} />);

    expect(screen.getByRole("button")).toHaveAccessibleName("1 message·3 tools");
    expect(screen.getByRole("button")).not.toHaveAccessibleName(/nested Codex subagent activity/i);
  });

  it("keeps expanded summaries on the same root-only count contract", () => {
    render(<TurnCollapseBar stats={STATS} durationMs={null} onClick={() => {}} />);

    expect(screen.getByRole("button")).toHaveAccessibleName(/1 message·3 tools/i);
    expect(screen.getByRole("button")).not.toHaveAccessibleName(/nested Codex subagent activity/i);
  });
});
