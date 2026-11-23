// @vitest-environment jsdom
/**
 * The sessions panel's status button (beside "+ New") and its per-space breakdown. In the Threads
 * view it leaves out unread counts: they count sessions while that view's list counts threads, so a
 * leader with five unread threads showed "1" (Jiayi, Nov 23).
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TreeViewGroupData } from "../utils/tree-grouping.js";
import { RecentSpacesStatus } from "./RecentSessionList.js";

afterEach(cleanup);

function space(id: string, counts: { running: number; permission: number; unread: number }): TreeViewGroupData {
  return {
    id,
    name: id.toUpperCase(),
    nodes: [],
    runningCount: counts.running,
    permCount: counts.permission,
    unreadCount: counts.unread,
  };
}

const SPACES = [
  space("takode", { running: 1, permission: 0, unread: 2 }),
  space("msi", { running: 0, permission: 1, unread: 1 }),
];

/** A tap, as on a phone: the button toggles the breakdown on touch. */
function tap(element: HTMLElement) {
  fireEvent.pointerDown(element, { pointerType: "touch" });
  fireEvent.click(element);
}

describe("RecentSpacesStatus", () => {
  it("shows every status total and per-space count by default (Recent view)", () => {
    render(<RecentSpacesStatus spaces={SPACES} />);
    const status = screen.getByTestId("recent-spaces-status");
    expect(within(status).getByTestId("status-count-unread").textContent).toBe("3");
    tap(status);
    const breakdown = screen.getByTestId("recent-spaces-status-breakdown");
    expect(
      within(breakdown)
        .getAllByTestId("status-count-unread")
        .map((count) => count.textContent),
    ).toEqual(["2", "1"]);
  });

  it("leaves out unread counts but keeps running and questions when hideUnread is set (Threads view)", () => {
    render(<RecentSpacesStatus spaces={SPACES} hideUnread />);
    const status = screen.getByTestId("recent-spaces-status");
    expect(within(status).queryByTestId("status-count-unread")).toBeNull();
    expect(within(status).getByTestId("status-count-running").textContent).toBe("1");
    expect(within(status).getByTestId("status-count-permission").textContent).toBe("1");
    tap(status);
    const breakdown = screen.getByTestId("recent-spaces-status-breakdown");
    expect(within(breakdown).queryByTestId("status-count-unread")).toBeNull();
    expect(within(breakdown).getByTestId("status-count-permission").textContent).toBe("1");
  });
});
