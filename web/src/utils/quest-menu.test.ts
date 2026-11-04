// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The quest menu every quest row and link shares (Questmaster rows, board rows, quest links in
 * messages and topic pages): the quest actions search results offer, under the same names, with
 * Copy first when text is selected and only the actions the quest has (no leader, no worker).
 */

const mocks = vi.hoisted(() => ({
  navigateToSessionThread: vi.fn(),
  navigateToSession: vi.fn(),
  openQuestInSide: vi.fn(),
  canOpenInSide: vi.fn(() => false),
  writeClipboardText: vi.fn(async () => {}),
}));
vi.mock("../store.js", () => ({
  useStore: {
    getState: () => ({
      sdkSessions: [
        { sessionId: "leader-1", sessionNum: 12 },
        { sessionId: "worker-1", sessionNum: 40 },
      ],
    }),
  },
}));
vi.mock("./routing.js", () => ({
  navigateToSessionThread: mocks.navigateToSessionThread,
  navigateToSession: mocks.navigateToSession,
}));
vi.mock("./side-column.js", () => ({ canOpenInSide: mocks.canOpenInSide, openQuestInSide: mocks.openQuestInSide }));
vi.mock("./copy-utils.js", () => ({ writeClipboardText: mocks.writeClipboardText }));

import { questMenuItems } from "./quest-menu.js";

beforeEach(() => vi.clearAllMocks());

describe("quest menu", () => {
  it("offers open, the thread in its leader, its worker and the quest number, named as in search", () => {
    const open = vi.fn();
    const onLeave = vi.fn();
    const items = questMenuItems({
      questId: "q-7",
      open,
      leaderSessionId: "leader-1",
      workerSessionId: "worker-1",
      onLeave,
    });
    expect(items.map((item) => item.label)).toEqual([
      "Open",
      "Open thread in leader #12",
      "Go to worker session #40",
      "Copy quest number",
    ]);
    items[0]!.onClick();
    expect(open).toHaveBeenCalled();
    items[1]!.onClick();
    expect(mocks.navigateToSessionThread).toHaveBeenCalledWith("leader-1", "q-7", false, 12);
    items[2]!.onClick();
    expect(mocks.navigateToSession).toHaveBeenCalledWith("worker-1");
    expect(onLeave).toHaveBeenCalledTimes(2);
    items[3]!.onClick();
    expect(mocks.writeClipboardText).toHaveBeenCalledWith("q-7");
  });

  it("puts Copy first for a selection, adds the side column when one is on screen, and skips missing sessions", () => {
    mocks.canOpenInSide.mockReturnValue(true);
    const items = questMenuItems({ questId: "q-7", open: () => {}, selectedText: "the quest's title" });
    expect(items.map((item) => item.label)).toEqual(["Copy", "Open", "Open in side column", "Copy quest number"]);
    items[0]!.onClick();
    expect(mocks.writeClipboardText).toHaveBeenCalledWith("the quest's title");
    items[2]!.onClick();
    expect(mocks.openQuestInSide).toHaveBeenCalledWith("q-7");
  });
});
