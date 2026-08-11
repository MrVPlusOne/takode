import { describe, expect, it } from "vitest";
import { CodexReasoningDetailAssembler } from "./codex-reasoning-detail-assembler.js";

describe("CodexReasoningDetailAssembler", () => {
  it("preserves three producer summary parts when completion changes the item id", () => {
    const assembler = new CodexReasoningDetailAssembler();
    assembler.start({
      turnId: "turn-1",
      itemId: "stream-item",
      summary: [],
      parentToolUseId: null,
    });

    const parts = [
      "**Addressing BugPilot Issues**\n\nFirst body.",
      "**Planning Cluster Access**\n\nSecond body.",
      "**Requesting Worker Details**\n\nThird body.",
    ];
    for (let index = 0; index < parts.length; index++) {
      assembler.addPart({
        turnId: "turn-1",
        itemId: "stream-item",
        summaryIndex: index,
        parentToolUseId: null,
      });
      expect(
        assembler.appendDelta({
          turnId: "turn-1",
          itemId: "stream-item",
          summaryIndex: index,
          delta: parts[index],
          parentToolUseId: null,
        }),
      ).toEqual([
        expect.objectContaining({
          sourceId: `turn-1-0-${index}`,
          summaryIndex: index,
          text: parts[index],
          status: "streaming",
        }),
      ]);
    }

    expect(
      assembler.complete({
        turnId: "turn-1",
        itemId: "completed-item",
        summary: parts,
        parentToolUseId: null,
      }),
    ).toEqual(
      parts.map((text, index) =>
        expect.objectContaining({
          sourceId: `turn-1-0-${index}`,
          summaryIndex: index,
          text,
          status: "complete",
        }),
      ),
    );
  });

  it("keeps replay and later reasoning occurrences stable within one turn", () => {
    const assembler = new CodexReasoningDetailAssembler();
    const first = assembler.complete({
      turnId: "turn-2",
      itemId: "first-complete",
      summary: ["First"],
      parentToolUseId: null,
    });
    const replay = assembler.complete({
      turnId: "turn-2",
      itemId: "first-complete",
      summary: ["First"],
      parentToolUseId: null,
    });
    assembler.start({
      turnId: "turn-2",
      itemId: "second-stream",
      summary: [],
      parentToolUseId: null,
    });
    const second = assembler.complete({
      turnId: "turn-2",
      itemId: "second-complete",
      summary: ["Second"],
      parentToolUseId: null,
    });

    expect(first[0]?.sourceId).toBe("turn-2-0-0");
    expect(replay[0]?.sourceId).toBe("turn-2-0-0");
    expect(second[0]?.sourceId).toBe("turn-2-1-0");
  });
});
