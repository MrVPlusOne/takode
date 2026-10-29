import { afterEach, describe, expect, it, vi } from "vitest";
const sendToSession = vi.hoisted(() => vi.fn(() => true));
vi.mock("../ws.js", () => ({ sendToSession }));
import { getSideViews, setSideViewsOf } from "./side-views.js";

afterEach(() => {
  sendToSession.mockClear();
});

/**
 * The conversations a leader's side column shows: the server sends their live messages only when it
 * knows them, so the browser tells it whenever the list changes (and again with each subscribe).
 */
describe("side views", () => {
  it("joins every owner's threads and tells the server only when the list changes", () => {
    const column = {};
    const other = {};
    setSideViewsOf("l1", column, ["Q-2", "topic:aaaa0001"]);
    expect(getSideViews("l1")).toEqual(["q-2", "topic:aaaa0001"]);
    expect(sendToSession).toHaveBeenLastCalledWith("l1", {
      type: "side_views_update",
      thread_keys: ["q-2", "topic:aaaa0001"],
    });
    sendToSession.mockClear();
    setSideViewsOf("l1", other, ["q-2"]);
    expect(sendToSession).not.toHaveBeenCalled();

    // An owner leaving (its column hidden or gone) drops only its own threads.
    setSideViewsOf("l1", column, []);
    expect(getSideViews("l1")).toEqual(["q-2"]);
    setSideViewsOf("l1", other, []);
    expect(getSideViews("l1")).toEqual([]);
    expect(sendToSession).toHaveBeenLastCalledWith("l1", { type: "side_views_update", thread_keys: [] });
    expect(getSideViews("l2")).toEqual([]);
  });
});
