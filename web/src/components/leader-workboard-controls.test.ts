// @vitest-environment jsdom
/**
 * Opening a leader's work board in place (Full board in the Overview menu): it opens on the active
 * board, or on the completed one when nothing is active, and closes from any view, without
 * routing away from the thread on screen.
 */
import { afterEach, describe, expect, it } from "vitest";
import { useStore } from "../store.js";
import { toggleLeaderWorkboard } from "./leader-workboard-controls.js";

afterEach(() => useStore.getState().reset());

describe("toggleLeaderWorkboard", () => {
  it("opens the active board in place, or the completed one when nothing is active", () => {
    window.location.hash = "#/session/s1?thread=q-1";
    useStore.setState({
      sessionBoards: new Map([["s1", [{ questId: "q-1", status: "IMPLEMENTING", updatedAt: 1 }]]]),
    } as never);
    toggleLeaderWorkboard("s1");
    expect(useStore.getState().leaderWorkboardViews.get("s1")).toBe("active");
    expect(window.location.hash).toBe("#/session/s1?thread=q-1");

    useStore.setState({
      sessionBoards: new Map(),
      sessionCompletedBoards: new Map([["s2", [{ questId: "q-2", status: "DONE", updatedAt: 2, completedAt: 2 }]]]),
    } as never);
    toggleLeaderWorkboard("s2");
    expect(useStore.getState().leaderWorkboardViews.get("s2")).toBe("completed");
  });

  it("closes the board from whichever view is open", () => {
    for (const view of ["active", "completed", "other"] as const) {
      useStore.getState().setLeaderWorkboardView("s1", view);
      toggleLeaderWorkboard("s1");
      expect(useStore.getState().leaderWorkboardViews.get("s1") ?? null).toBeNull();
    }
  });
});
