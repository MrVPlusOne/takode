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

  it("includes the number of commands when a run contains several commands", () => {
    // Counts make repeated command-only activity more informative without exposing individual previews.
    expect(
      summarizeToolActivity([
        { id: "bash-1", name: "Bash", input: { command: "git status" } },
        { id: "bash-2", name: "Bash", input: { command: "bun test" } },
        { id: "bash-3", name: "Bash", input: { command: "git diff --check" } },
      ]),
    ).toBe("Ran 3 commands");
  });

  it("summarizes worker events as a compact activity category", () => {
    expect(
      summarizeToolActivity([
        { id: "bash-1", name: "Bash", input: { command: "bun test" } },
        { id: "worker-1", name: "SendMessage", kind: "worker_event", input: {} },
        { id: "worker-2", name: "SendMessage", kind: "worker_event", input: {} },
      ]),
    ).toBe("Ran command, 2 worker events");
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

  it("labels mixed worker-event activity without calling every item a tool call", () => {
    render(
      <CompactToolActivity
        items={[
          { id: "bash-1", name: "Bash", input: { command: "bun test" } },
          { id: "worker-1", name: "SendMessage", kind: "worker_event", input: {} },
        ]}
      >
        <div>Full worker-event details</div>
      </CompactToolActivity>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Show 2 activity items/ }));
    expect(screen.getByText("Full worker-event details")).toBeTruthy();
  });

  it("keeps interactive tools visible while allowing notification commands to compact", () => {
    // Notification panels render separately, so their underlying Bash command should remain passive tool activity.
    expect(isCompactToolActivityItem({ id: "ask", name: "AskUserQuestion", input: {} })).toBe(false);
    expect(isCompactToolActivityItem({ id: "plan", name: "ExitPlanMode", input: {} })).toBe(false);
    expect(
      isCompactToolActivityItem({
        id: "notify",
        name: "Bash",
        input: { command: "takode notify review --summary ready" },
      }),
    ).toBe(true);
  });
});
