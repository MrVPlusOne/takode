import { describe, expect, it } from "vitest";
import { threadNameFromMessage } from "./NewThreadPage.js";

/**
 * A new thread is named after its first message's first words until the leader names it: short,
 * from the first line with text, without Markdown marks, and marked as cut when it was cut.
 */
describe("threadNameFromMessage", () => {
  it("takes the first words of the first line with text, cut at a word", () => {
    expect(threadNameFromMessage("Quick question: why can't Lingxiao's Claude use web search with Copilot?")).toBe(
      "Quick question: why can't Lingxiao's Claude use…",
    );
    expect(threadNameFromMessage("\n\n## Phone can't reach Takode\nSafari says the server stopped")).toBe(
      "Phone can't reach Takode",
    );
  });

  it("falls back to a plain name for a message with no text", () => {
    expect(threadNameFromMessage("   \n ")).toBe("New thread");
  });
});
