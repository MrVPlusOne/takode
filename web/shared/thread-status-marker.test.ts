import { describe, expect, it } from "vitest";
import {
  extractThreadStatusMarkersFromText,
  isThreadStatusMarkerLikeLine,
  parseThreadStatusMarkerLine,
} from "./thread-status-marker.js";

describe("thread-status-marker", () => {
  it("parses strict Thread Waiting and Thread Ready marker lines", () => {
    expect(parseThreadStatusMarkerLine("{[(Thread Waiting: main | waiting for herd event)]}")).toMatchObject({
      kind: "waiting",
      label: "Thread Waiting",
      target: { threadKey: "main" },
      summary: "waiting for herd event",
    });
    expect(parseThreadStatusMarkerLine("{[(Thread Ready: q-1258 | code review dispatched)]}")).toMatchObject({
      kind: "ready",
      label: "Thread Ready",
      target: { threadKey: "q-1258", questId: "q-1258" },
      summary: "code review dispatched",
    });
  });

  it("rejects non-standalone, loose, or unsupported marker syntax", () => {
    expect(parseThreadStatusMarkerLine(" {[(Thread Waiting: main | indented)]}")).toBeNull();
    expect(parseThreadStatusMarkerLine("{[(Thread Waiting: main|missing spaces)]}")).toBeNull();
    expect(parseThreadStatusMarkerLine("{[(Thread Waiting: MAIN | uppercase target)]}")).toBeNull();
    expect(parseThreadStatusMarkerLine("{[(Thread Needs Input: main | ask user)]}")).toBeNull();
    expect(parseThreadStatusMarkerLine("prefix {[(Thread Ready: main | done)]}")).toBeNull();
    expect(parseThreadStatusMarkerLine("{[(Thread Ready: main | trailing space )]}")).toBeNull();
  });

  it("strips only valid standalone marker lines and preserves invalid marker-looking prose", () => {
    const extracted = extractThreadStatusMarkersFromText(
      [
        "Normal response.",
        "{[(Thread Waiting: main | waiting for reviewer)]}",
        "{[(Thread Needs Input: main | invalid stays visible)]}",
        "{[(Thread Ready: q-42 | ready for review)]}",
        "Done.",
      ].join("\n"),
    );

    expect(extracted.markers.map((marker) => [marker.kind, marker.target.threadKey, marker.summary])).toEqual([
      ["waiting", "main", "waiting for reviewer"],
      ["ready", "q-42", "ready for review"],
    ]);
    expect(extracted.text).toBe(
      ["Normal response.", "{[(Thread Needs Input: main | invalid stays visible)]}", "Done."].join("\n"),
    );
  });

  it("recognizes marker-like invalid lines for deliberate visible fallback handling", () => {
    expect(isThreadStatusMarkerLikeLine("{[(Thread Needs Input: main | ask)]}")).toBe(true);
    expect(isThreadStatusMarkerLikeLine("ordinary prose")).toBe(false);
  });
});
