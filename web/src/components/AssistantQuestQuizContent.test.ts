// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  extractQuestQuizMarkerIds,
  parseQuestQuizContentSegments,
  stripQuestQuizMarkers,
} from "./AssistantQuestQuizContent.js";

describe("AssistantQuestQuizContent directive parsing", () => {
  it("parses standalone quest quiz directives as ordered content segments", () => {
    const text = "Final summary.\n\n{[(Quest Quiz: q-8)]}\n\nFollow-up note.";

    expect(parseQuestQuizContentSegments(text)).toEqual([
      { kind: "text", text: "Final summary." },
      { kind: "quiz", questId: "q-8" },
      { kind: "text", text: "Follow-up note." },
    ]);
    expect(stripQuestQuizMarkers(text)).toBe("Final summary.\n\nFollow-up note.");
    expect(extractQuestQuizMarkerIds(text)).toEqual(["q-8"]);
  });

  it("only treats a directive as active when it is alone on a physical line", () => {
    const text = "This literal {[(Quest Quiz: q-8)]} should stay visible.";

    expect(parseQuestQuizContentSegments(text)).toEqual([{ kind: "text", text }]);
    expect(extractQuestQuizMarkerIds(text)).toEqual([]);
  });

  it("ignores directive-shaped text inside fenced code blocks", () => {
    const text = [
      "Keep this code sample literal:",
      "",
      "```text",
      "{[(Quest Quiz: q-8)]}",
      "```",
      "",
      "{[(Quest Quiz: q-9)]}",
    ].join("\n");

    expect(parseQuestQuizContentSegments(text)).toEqual([
      {
        kind: "text",
        text: "Keep this code sample literal:\n\n```text\n{[(Quest Quiz: q-8)]}\n```",
      },
      { kind: "quiz", questId: "q-9" },
    ]);
    expect(extractQuestQuizMarkerIds(text)).toEqual(["q-9"]);
  });

  it("handles CRLF directive lines", () => {
    const text = "Done.\r\n\r\n  {[(Quest Quiz: Q-12)]}  \r\n";

    expect(parseQuestQuizContentSegments(text)).toEqual([
      { kind: "text", text: "Done." },
      { kind: "quiz", questId: "q-12" },
    ]);
  });
});
