/** Tests for the collapsed herd event chip summary. */
import { describe, expect, it } from "vitest";
import { getHerdEventHeaderSummary } from "./herd-event-classification.js";

describe("getHerdEventHeaderSummary", () => {
  it("keeps the quiet label of a held quiet turn and drops its summary", () => {
    // The leader sees at a glance that the line needs nothing; the summary stays in the expanded view.
    expect(getHerdEventHeaderSummary("#2978 | turn_end | quiet | 3 quiet turns, latest: nothing new | 4m ago")).toBe(
      "#2978 | turn_end | quiet",
    );
  });

  it("keeps an ordinary completed turn compact", () => {
    expect(getHerdEventHeaderSummary("#8 | turn_end | ✓ turn complete 15.3s | tools: 5")).toBe("#8 | turn_end");
  });
});
