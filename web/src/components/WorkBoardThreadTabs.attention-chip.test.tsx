// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ThreadTabRail } from "./WorkBoardThreadTabs.js";
import { useStore } from "../store.js";

// On desktop a leader's Next attention chip sits right after the thread tabs, where it never
// covers the feed's text when the topic panel narrows the chat. ChatView passes the thread the feed
// shows; without it (phones, other sessions) the tab row has no chip and the feed keeps its own.

afterEach(cleanup);

function installNeedsInput(sessionId: string) {
  useStore.setState({
    sessionNotifications: new Map([
      [
        sessionId,
        [{ id: "n-1", category: "needs-input", summary: "Pick one", timestamp: 1, messageId: "m-1", done: false }],
      ],
    ]),
  });
}

function renderRail(sessionId: string, attentionChipThreadKey?: string) {
  render(
    <ThreadTabRail
      tabs={[]}
      sessionId={sessionId}
      currentThreadKey="main"
      onSelectThread={() => {}}
      attentionChipThreadKey={attentionChipThreadKey}
    />,
  );
}

describe("thread tab row attention chip", () => {
  it("shows the chip right after the tabs, outside the tab list, only when asked to", () => {
    installNeedsInput("leader-1");
    renderRail("leader-1");
    expect(screen.queryByTestId("session-attention-chip")).toBeNull();
    cleanup();

    renderRail("leader-1", "main");
    const bar = screen.getByTestId("thread-tab-group-bar");
    const chip = within(bar).getByTestId("session-attention-chip");
    const tabList = within(bar).getByRole("tablist");
    expect(tabList).not.toContainElement(chip);
    // Same row, directly after the tabs.
    expect(tabList.nextElementSibling).toBe(chip);
    expect(chip).toHaveTextContent("1/1·Next");
  });

  it("opens its list right under the chip instead of at the window's right edge", () => {
    installNeedsInput("leader-2");
    renderRail("leader-2", "main");
    const chip = screen.getByTestId("session-attention-chip");
    chip.getBoundingClientRect = () => new DOMRect(400, 40, 110, 28);
    // On Main nothing can be closed, so a right-click opens the list.
    fireEvent.contextMenu(chip.querySelector("button")!);
    const list = screen.getByRole("dialog", { name: "Notification inbox" });
    expect(list.style.left).toBe("400px");
    expect(list.style.right).toBe("auto");
  });
});
