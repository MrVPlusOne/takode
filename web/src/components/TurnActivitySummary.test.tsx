// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { CollapsedActivityBar, TurnCollapseBar } from "./TurnActivitySummary.js";

const STATS = { messageCount: 1, toolCount: 3, subagentCount: 0, herdEventCount: 0 };

describe("TurnActivitySummary native Codex tool scope", () => {
  it("qualifies collapsed root tool totals when nested native-child activity may be included", () => {
    render(
      <CollapsedActivityBar
        stats={STATS}
        durationMs={null}
        leaderMode={false}
        toolCountMayIncludeNestedCodexSubagents
        onClick={() => {}}
      />,
    );

    expect(screen.getByRole("button")).toHaveAccessibleName(
      /3 tools; tool count may include root and nested Codex subagent activity/i,
    );
  });

  it("keeps ordinary and expanded summaries free of the qualifier unless the native aggregate requests it", () => {
    const view = render(<CollapsedActivityBar stats={STATS} durationMs={null} leaderMode={false} onClick={() => {}} />);
    expect(screen.getByRole("button")).not.toHaveAccessibleName(/nested Codex subagent activity/i);

    view.rerender(
      <TurnCollapseBar stats={STATS} durationMs={null} toolCountMayIncludeNestedCodexSubagents onClick={() => {}} />,
    );
    expect(screen.getByRole("button")).toHaveAccessibleName(/nested Codex subagent activity/i);
  });
});
