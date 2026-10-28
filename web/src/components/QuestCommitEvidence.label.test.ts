import { describe, expect, it } from "vitest";
import { questCommitsLabel } from "./QuestCommitEvidence.js";

// The quest view's commit chip counts code commits the way the quest strip's card does, and names
// memory-repository commits apart: Jiayi saw "3 commits" in the strip and "7 commits" in the quest
// view for the same quest (3 code commits and 4 memory commits).
describe("questCommitsLabel", () => {
  const entries = (code: number, memory: number) => [
    ...Array.from({ length: code }, () => ({ kind: "code" as const })),
    ...Array.from({ length: memory }, () => ({ kind: "memory" as const })),
  ];

  it("names memory commits apart from code commits", () => {
    expect(questCommitsLabel(entries(3, 4))).toBe("3 commits · 4 memory");
    expect(questCommitsLabel(entries(1, 1))).toBe("1 commit · 1 memory");
  });

  it("says only commits without memory commits, and only memory commits without code", () => {
    expect(questCommitsLabel(entries(2, 0))).toBe("2 commits");
    expect(questCommitsLabel(entries(0, 1))).toBe("1 memory commit");
    expect(questCommitsLabel(entries(0, 2))).toBe("2 memory commits");
  });
});
