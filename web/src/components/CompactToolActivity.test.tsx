// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import {
  CompactToolActivity,
  isCompactToolActivityItem,
  summarizeToolActivity,
  type CompactToolActivityItem,
} from "./CompactToolActivity.js";

const MIXED_ACTIVITY: CompactToolActivityItem[] = [
  { id: "read-1", name: "Read", input: { file_path: "src/a.ts" } },
  { id: "read-2", name: "Read", input: { file_path: "src/b.ts" } },
  { id: "bash-1", name: "Bash", input: { command: "bun test" } },
  { id: "grep-1", name: "Grep", input: { pattern: "quietMode", path: "src" } },
];

describe("CompactToolActivity", () => {
  it("summarizes a mixed run by intent instead of exposing command previews", () => {
    // The collapsed label should communicate what happened without repeating every tool name or argument.
    expect(summarizeToolActivity(MIXED_ACTIVITY)).toBe("Read files, ran command, searched for quietMode");
  });

  it("keeps full tool details hidden until the summary is expanded", () => {
    // This verifies the core quiet-view contract: concise by default, with lossless details one click away.
    render(
      <CompactToolActivity items={MIXED_ACTIVITY}>
        <div>Full command and result details</div>
      </CompactToolActivity>,
    );

    expect(screen.getByText("Read files, ran command, searched for quietMode")).toBeTruthy();
    expect(screen.queryByText("Full command and result details")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Show 4 tool calls/ }));
    expect(screen.getByText("Full command and result details")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Hide 4 tool calls/ }).getAttribute("aria-expanded")).toBe("true");
  });

  it("does not classify interactive or notification tools as passive activity", () => {
    // Questions, plan review, and Takode notifications must remain visible because they can require user action.
    expect(isCompactToolActivityItem({ id: "ask", name: "AskUserQuestion", input: {} })).toBe(false);
    expect(isCompactToolActivityItem({ id: "plan", name: "ExitPlanMode", input: {} })).toBe(false);
    expect(
      isCompactToolActivityItem({
        id: "notify",
        name: "Bash",
        input: { command: "takode notify review --summary ready" },
      }),
    ).toBe(false);
  });
});
