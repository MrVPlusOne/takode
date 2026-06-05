import { describe, expect, it } from "vitest";
import { buildThreadRoutingReminderContent } from "./thread-routing-reminder.js";

describe("buildThreadRoutingReminderContent", () => {
  // Leaders recovering from compaction need to know whether visible text or a shell command missed routing.
  it("identifies missing markers on visible leader text", () => {
    const content = buildThreadRoutingReminderContent({ reason: "missing", source: "visible_text" });

    expect(content).toContain("Missing thread marker on visible leader text");
    expect(content).toContain("previous visible leader message");
    expect(content).toContain("`[thread:main]` or `[thread:q-N]` as the first line");
    expect(content).toContain("`# thread:main` or `# thread:q-N`");
    expect(content).not.toContain("previous leader response");
  });

  // Shell-command reminders should not imply that the user-visible assistant text was the mistake.
  it("identifies missing markers on leader shell commands", () => {
    const content = buildThreadRoutingReminderContent({ reason: "missing", source: "shell_command" });

    expect(content).toContain("Missing thread marker on leader shell command");
    expect(content).toContain("previous leader shell command");
    expect(content).toContain("`# thread:main` or `# thread:q-N`");
    expect(content).toContain("`[thread:main]` or `[thread:q-N]` as the first line");
    expect(content).not.toContain("previous leader response");
  });

  // Older persisted routing errors may lack source metadata; keep the copy honest about uncertainty.
  it("uses uncertainty wording when the routing source is unavailable", () => {
    const content = buildThreadRoutingReminderContent({ reason: "missing" });

    expect(content).toContain("output type is unavailable");
    expect(content).toContain("If it was user-visible leader text");
    expect(content).toContain("If it was a leader shell command");
    expect(content).not.toContain("previous leader response");
  });

  it("keeps invalid marker details with visible text attribution", () => {
    const content = buildThreadRoutingReminderContent({
      reason: "invalid",
      source: "visible_text",
      marker: "[thread:side]",
    });

    expect(content).toContain("Invalid marker: [thread:side] on visible leader text");
  });
});
