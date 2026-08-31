// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_LEADER_OPEN_THREAD_TABS,
  normalizeLeaderOpenThreadKeys,
  placeLeaderOpenThreadTabKey,
} from "../../shared/leader-open-thread-tabs.js";
import {
  clearOpenThreadTabKeys,
  MAX_OPEN_THREAD_TAB_STORAGE_CHARS,
  readOpenThreadTabKeys,
} from "./leader-open-thread-tabs.js";

const SERVER_ID = "test-server";
const SESSION_ID = "s1";
const STORAGE_KEY = `${SERVER_ID}:cc-leader-open-thread-tabs:${SESSION_ID}`;

describe("leader open thread tabs storage migration", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("cc-server-id", SERVER_ID);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("restores compact normalized thread keys with server scoping", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([" Q-941 ", "main", "all", "q-777", "q-941"]));

    expect(readOpenThreadTabKeys(SESSION_ID)).toEqual(["q-941", "q-777"]);
  });

  it("dedupes and caps restored tab keys", () => {
    const manyKeys = Array.from({ length: MAX_LEADER_OPEN_THREAD_TABS + 5 }, (_, index) => `q-${index + 1}`);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(["q-1", ...manyKeys, "q-2"]));

    expect(readOpenThreadTabKeys(SESSION_ID)).toEqual(manyKeys.slice(0, MAX_LEADER_OPEN_THREAD_TABS));
  });

  it("recovers legacy tab descriptor shapes without restoring full payloads", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        tabs: [
          { threadKey: " Q-1085 ", title: "Large legacy title", messages: [{ id: "m1", content: "ignored" }] },
          { questId: "q-1086", boardRow: { title: "ignored" } },
          { threadKey: "main" },
          { threadKey: "q-1085" },
        ],
      }),
    );

    expect(readOpenThreadTabKeys(SESSION_ID)).toEqual(["q-1085", "q-1086"]);
  });

  it("treats oversized legacy values as empty and lets migration clear the key", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ tabs: [{ threadKey: "q-1085", payload: "x".repeat(MAX_OPEN_THREAD_TAB_STORAGE_CHARS) }] }),
    );

    expect(readOpenThreadTabKeys(SESSION_ID)).toEqual([]);
    clearOpenThreadTabKeys(SESSION_ID);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("treats corrupt legacy values as empty without throwing through callers", () => {
    localStorage.setItem(STORAGE_KEY, "{not-json");

    expect(() => readOpenThreadTabKeys(SESSION_ID)).not.toThrow();
    expect(readOpenThreadTabKeys(SESSION_ID)).toEqual([]);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("Ignoring invalid leader open thread tabs storage"),
      expect.any(SyntaxError),
    );
  });

  it("does not throw when storage reads fail", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(function getItem(this: Storage, key) {
      if (String(key).includes("cc-leader-open-thread-tabs")) {
        throw new DOMException("Storage unavailable", "SecurityError");
      }
      return null;
    });

    expect(() => readOpenThreadTabKeys(SESSION_ID)).not.toThrow();
    expect(readOpenThreadTabKeys(SESSION_ID)).toEqual([]);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("Could not read leader open thread tabs storage"),
      expect.any(DOMException),
    );
  });

  it("does not throw when clearing migrated storage fails", () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(function removeItem(this: Storage, key) {
      if (String(key).includes("cc-leader-open-thread-tabs")) {
        throw new DOMException("Storage unavailable", "SecurityError");
      }
    });

    expect(() => clearOpenThreadTabKeys(SESSION_ID)).not.toThrow();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("Could not clear migrated leader open thread tabs storage"),
      expect.any(DOMException),
    );
  });

  it("keeps shared tab placement bounded when opening more than the retained maximum", () => {
    const baseline = Array.from({ length: MAX_LEADER_OPEN_THREAD_TABS }, (_, index) => `q-${index + 1}`);
    const next = placeLeaderOpenThreadTabKey(baseline, "q-1000", "first");

    expect(next).toHaveLength(MAX_LEADER_OPEN_THREAD_TABS);
    expect(next[0]).toBe("q-1000");
    expect(next).not.toContain(`q-${MAX_LEADER_OPEN_THREAD_TABS}`);
  });

  it("normalizes direct arrays without accepting main, all, empty, or duplicate keys", () => {
    expect(normalizeLeaderOpenThreadKeys(["", "main", "all", " Q-1 ", "q-1", "q-2"])).toEqual(["q-1", "q-2"]);
  });
});
