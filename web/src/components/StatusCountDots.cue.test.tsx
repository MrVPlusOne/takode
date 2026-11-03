// @vitest-environment jsdom
/**
 * The sidebar Threads view's counts pop once when a new question or result arrives (Jiayi, Nov 3),
 * where the row knows when its newest one came; counts without that time (session cards) never do.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusCountDots } from "./SessionItem.js";

describe("StatusCountDots cues", () => {
  it("pops a count that rises with a fresh newest item, and not one that was already there", () => {
    const old = Date.now() - 10 * 60_000;
    const view = render(
      <StatusCountDots counts={{ running: 0, permission: 1, unread: 1, permissionAt: old, unreadAt: old }} />,
    );
    const cued = (key: string) => screen.getByTestId(`status-count-${key}`).hasAttribute("data-cue");
    expect(cued("permission")).toBe(false);
    expect(cued("unread")).toBe(false);
    view.rerender(
      <StatusCountDots counts={{ running: 0, permission: 1, unread: 2, permissionAt: old, unreadAt: Date.now() }} />,
    );
    expect(cued("unread")).toBe(true);
    expect(cued("permission")).toBe(false);
  });

  it("never cues counts given without times", () => {
    const view = render(<StatusCountDots counts={{ running: 0, permission: 1, unread: 0 }} />);
    view.rerender(<StatusCountDots counts={{ running: 0, permission: 2, unread: 0 }} />);
    expect(screen.getByTestId("status-count-permission").hasAttribute("data-cue")).toBe(false);
  });
});
