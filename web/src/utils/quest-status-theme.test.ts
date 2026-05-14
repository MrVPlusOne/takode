import { describe, expect, it } from "vitest";
import { QUEST_STATUS_THEME, getQuestStatusTheme } from "./quest-status-theme.js";

describe("quest-status-theme", () => {
  it("uses the workflow-aligned quest status palette", () => {
    expect(QUEST_STATUS_THEME.idea.text).toBe("text-cc-status-idea");
    expect(QUEST_STATUS_THEME.refined.text).toBe("text-cc-status-refined");
    expect(QUEST_STATUS_THEME.in_progress.text).toBe("text-cc-status-progress");
    expect(QUEST_STATUS_THEME.done.text).toBe("text-cc-status-done");
  });

  it("returns a neutral fallback for unknown statuses", () => {
    const unknown = getQuestStatusTheme("paused");
    expect(unknown.label).toBe("paused");
    expect(unknown.text).toBe("text-cc-muted");
    expect(unknown.dot).toBe("bg-cc-status-idea");
  });
});
