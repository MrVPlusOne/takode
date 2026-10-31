// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isRememberedFolded,
  REMEMBERED_FOLDS_KEY,
  rememberedFoldIds,
  resetRememberedFoldsForTest,
  setRememberedFolded,
  toggleRememberedFold,
  useRememberedFold,
} from "./remembered-folds.js";

/**
 * Remembered folds: every collapsible section keeps the user's open/closed choice in one browser
 * entry. These tests cover what made folds forget before: a whole-state write from a tab's older
 * copy, a full storage, and the per-section entries of earlier builds, which move over once.
 */

function saved(): Record<string, boolean> {
  return JSON.parse(localStorage.getItem(REMEMBERED_FOLDS_KEY) ?? "{}");
}

/** Starts a page load: earlier builds' entries move on the first read. */
function reload() {
  resetRememberedFoldsForTest();
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("cc-server-id", "srv");
  reload();
});

afterEach(() => vi.restoreAllMocks());

describe("remembered folds", () => {
  it("shows a fold's default until the user changes it, then keeps the choice across reloads", () => {
    expect(isRememberedFolded("sidebar:archived", true)).toBe(true);
    toggleRememberedFold("sidebar:archived", true);
    reload();
    expect(isRememberedFolded("sidebar:archived", true)).toBe(false);
    expect(saved()).toEqual({ "sidebar:archived": false });
  });

  it("never overwrites another tab's choice with this tab's older copy", () => {
    setRememberedFolded("stack:sidebar-topics:sessions", true);
    // Another tab folds a different group after this one last read.
    localStorage.setItem(
      REMEMBERED_FOLDS_KEY,
      JSON.stringify({ "stack:sidebar-topics:sessions": true, "stack:sidebar-topics:leaders": true }),
    );
    setRememberedFolded("overview:running", false);
    expect(saved()).toEqual({
      "stack:sidebar-topics:sessions": true,
      "stack:sidebar-topics:leaders": true,
      "overview:running": false,
    });
  });

  it("updates folds on screen when another tab changes one", () => {
    function Fold() {
      const [folded] = useRememberedFold("sidebar:scheduled");
      return <span data-testid="fold">{folded ? "folded" : "open"}</span>;
    }
    render(<Fold />);
    expect(screen.getByTestId("fold").textContent).toBe("open");
    act(() => {
      localStorage.setItem(REMEMBERED_FOLDS_KEY, JSON.stringify({ "sidebar:scheduled": true }));
      window.dispatchEvent(new StorageEvent("storage", { key: REMEMBERED_FOLDS_KEY }));
    });
    expect(screen.getByTestId("fold").textContent).toBe("folded");
  });

  it("keeps a choice for the rest of the page when the browser storage is full", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage quota exceeded", "QuotaExceededError");
    });
    setRememberedFolded("space:group-a", true);
    expect(isRememberedFolded("space:group-a")).toBe(true);
    expect(localStorage.getItem(REMEMBERED_FOLDS_KEY)).toBeNull();
  });

  it("drops the least recently changed choices past its size limit", () => {
    for (let index = 0; index < 1005; index += 1) setRememberedFolded(`tree-node:s${index}`, true);
    const ids = Object.keys(saved());
    expect(ids).toHaveLength(1000);
    expect(ids[0]).toBe("tree-node:s5");
    expect(rememberedFoldIds("tree-node:").at(-1)).toBe("s1004");
  });

  it("moves earlier builds' folds over once and removes their entries, keeping layout state", () => {
    localStorage.setItem("srv:cc-collapsed-tree-groups", JSON.stringify(["g1"]));
    localStorage.setItem("srv:cc-collapsed-tree-nodes", JSON.stringify(["s1"]));
    localStorage.setItem("srv:cc-expanded-herd-nodes", JSON.stringify(["l1"]));
    localStorage.setItem("srv:cc-todo-collapsed-categories", JSON.stringify(["work"]));
    localStorage.setItem("srv:cc-overview-open", JSON.stringify(["running"]));
    localStorage.setItem("srv:cc-topic-collapsed-sections", JSON.stringify({ t1: { history: true, now: false } }));
    localStorage.setItem("cc-collapse-usage", "1");
    localStorage.setItem("cc-collapse-mcp", "0");
    localStorage.setItem(
      "cc-stacked-panes",
      JSON.stringify({ "sidebar-topics": { folded: ["sessions"], weights: { topics: 3 } } }),
    );
    localStorage.setItem("cc-side-columns", JSON.stringify({ l1: { items: [], open: "home", overviewFolded: true } }));
    // A copy kept for another server is never read again and goes too.
    localStorage.setItem("old-srv:cc-collapsed-tree-groups", JSON.stringify(["g9"]));

    expect(isRememberedFolded("space:g1")).toBe(true);
    expect(saved()).toEqual({
      "space:g1": true,
      "tree-node:s1": true,
      "workers:l1": false,
      "todo-category:work": true,
      "overview:running": false,
      "topic:t1:history": true,
      "topic:t1:now": false,
      "cc-collapse-usage": true,
      "cc-collapse-mcp": false,
      "stack:sidebar-topics:sessions": true,
      "side-overview:l1": true,
    });
    for (const key of [
      "srv:cc-collapsed-tree-groups",
      "old-srv:cc-collapsed-tree-groups",
      "srv:cc-overview-open",
      "srv:cc-topic-collapsed-sections",
      "cc-collapse-usage",
    ]) {
      expect(localStorage.getItem(key)).toBeNull();
    }
    expect(JSON.parse(localStorage.getItem("cc-stacked-panes")!)).toEqual({
      "sidebar-topics": { weights: { topics: 3 } },
    });
    expect(JSON.parse(localStorage.getItem("cc-side-columns")!)).toEqual({ l1: { items: [], open: "home" } });
  });
});
