// @vitest-environment jsdom
/**
 * The lists a leader's breadcrumb navigation shares: counting a place's unread results, and
 * showing the tab on screen as read.
 */
import { describe, expect, it } from "vitest";
import { countUnreadResults, readOnScreen } from "./ThreadTabGroups.js";

describe("readOnScreen", () => {
  // The browser marks a result in the open tab read before the server confirms it, so the place
  // picker must not show the tab on screen with an unread result in the meantime.
  const tab = {
    threadKey: "q-34",
    title: "Quest",
    needsInput: false,
    mutedNeedsInput: false,
    blueNudge: true,
    canClose: true,
    updatedAt: 1,
  };

  it("clears the unread result of the tab on screen only", () => {
    expect(readOnScreen(tab, "q-34").blueNudge).toBe(false);
    expect(readOnScreen(tab, "q-35").blueNudge).toBe(true);
  });
});

describe("countUnreadResults", () => {
  it("counts unread results as the attention list does: finished quests apart, one request once", () => {
    expect(
      countUnreadResults([
        { id: "n-1", answerTo: ["u1"], unreadReason: "answer" },
        { id: "n-2", answerTo: ["u1"], unreadReason: "report" },
        { id: "n-3", unreadReason: "answer" },
        { id: "n-4", unreadReason: "quest-complete" },
      ]),
    ).toEqual({ answers: 2, finished: 1 });
  });
});
