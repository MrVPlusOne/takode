import { describe, it, expect } from "vitest";
import { questLabel } from "./quest-helpers.js";

describe("questLabel", () => {
  // Pure function that prefixes session names with ☐/☑ based on quest status.

  it("returns plain name for non-quest sessions", () => {
    expect(questLabel("My Session", false, undefined)).toBe("My Session");
    expect(questLabel("My Session", false, "in_progress")).toBe("My Session");
  });

  it("returns ☐ prefix for in-progress quests", () => {
    expect(questLabel("Fix auth bug", true, "in_progress")).toBe("☐ Fix auth bug");
  });

  it("returns ☑ prefix for done quests under review", () => {
    expect(questLabel("Fix auth bug", true, "done", true)).toBe("☑ Fix auth bug");
  });

  it("returns ☐ prefix when quest status is undefined", () => {
    // Edge case: quest-named but status not yet set
    expect(questLabel("Mystery quest", true, undefined)).toBe("☐ Mystery quest");
  });

  it("returns ☐ prefix for final done quests without review metadata", () => {
    // Only done quests still in the review workflow get the checked box.
    expect(questLabel("Done quest", true, "done")).toBe("☐ Done quest");
    expect(questLabel("Idea quest", true, "idea")).toBe("☐ Idea quest");
  });
});
