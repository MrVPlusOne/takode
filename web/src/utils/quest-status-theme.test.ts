import { describe, expect, it } from "vitest";
import { QUEST_STATUS_THEME, getQuestStatusTheme } from "./quest-status-theme.js";

describe("quest-status-theme", () => {
  it("uses the workflow-aligned quest status palette", () => {
    expect(QUEST_STATUS_THEME.idea.text).toBe("text-zinc-400");
    expect(QUEST_STATUS_THEME.refined.text).toBe("text-amber-400");
    expect(QUEST_STATUS_THEME.in_progress.text).toBe("text-green-400");
    expect(QUEST_STATUS_THEME.needs_verification.text).toBe("text-blue-400");
    expect(QUEST_STATUS_THEME.done.text).toBe("text-purple-400");
  });

  it("returns a neutral fallback for unknown statuses", () => {
    const unknown = getQuestStatusTheme("paused");
    expect(unknown.label).toBe("paused");
    expect(unknown.text).toBe("text-cc-muted");
    expect(unknown.dot).toBe("bg-zinc-400");
  });
});
