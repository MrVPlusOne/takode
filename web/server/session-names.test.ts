import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getName,
  setName,
  getAllNames,
  removeName,
  getNextLeaderNumber,
  _resetForTest,
  _flushForTest,
} from "./session-names.js";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "session-names-test-"));
  _resetForTest(join(tempDir, "session-names.json"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("session-names", () => {
  it("returns undefined for unknown session", () => {
    expect(getName("unknown")).toBeUndefined();
  });

  it("setName + getName round-trip", () => {
    setName("s1", "Fix auth bug");
    expect(getName("s1")).toBe("Fix auth bug");
  });

  // Persistence tests must await _flushForTest() since writes are now async
  it("persists to disk in new format", async () => {
    setName("s1", "My Session");
    await _flushForTest();
    const raw = readFileSync(join(tempDir, "session-names.json"), "utf-8");
    const data = JSON.parse(raw);
    expect(data).toEqual({ names: { s1: "My Session" }, leaderCounter: 0 });
  });

  it("getAllNames returns a copy of all names", () => {
    setName("s1", "First");
    setName("s2", "Second");
    const all = getAllNames();
    expect(all).toEqual({ s1: "First", s2: "Second" });
    // Verify it's a copy (mutating doesn't affect internal state)
    all.s3 = "Third";
    expect(getName("s3")).toBeUndefined();
  });

  it("removeName deletes a name", async () => {
    setName("s1", "Session One");
    removeName("s1");
    expect(getName("s1")).toBeUndefined();
    await _flushForTest();
    const raw = readFileSync(join(tempDir, "session-names.json"), "utf-8");
    expect(JSON.parse(raw)).toEqual({ names: {}, leaderCounter: 0 });
  });

  it("overwrites existing name", () => {
    setName("s1", "Old Name");
    setName("s1", "New Name");
    expect(getName("s1")).toBe("New Name");
  });

  it("creates parent directories if needed", () => {
    const nestedPath = join(tempDir, "nested", "dir", "names.json");
    _resetForTest(nestedPath);
    setName("s1", "Deep Session");
    expect(getName("s1")).toBe("Deep Session");
  });

  it("loads existing data from disk on first access", () => {
    // Write data to file before any module access
    writeFileSync(join(tempDir, "session-names.json"), JSON.stringify({ existing: "Pre-existing Name" }));
    // Reset to re-read from the file
    _resetForTest(join(tempDir, "session-names.json"));
    expect(getName("existing")).toBe("Pre-existing Name");
  });

  it("handles corrupt JSON gracefully", () => {
    writeFileSync(join(tempDir, "session-names.json"), "NOT VALID JSON");
    _resetForTest(join(tempDir, "session-names.json"));
    expect(getName("any")).toBeUndefined();
  });
});

describe("leader counter", () => {
  it("increments from 1 on first call", () => {
    expect(getNextLeaderNumber()).toBe(1);
    expect(getNextLeaderNumber()).toBe(2);
    expect(getNextLeaderNumber()).toBe(3);
  });

  it("persists counter across resets (simulates server restart)", async () => {
    getNextLeaderNumber(); // 1
    getNextLeaderNumber(); // 2
    await _flushForTest();
    // Simulate server restart: reset in-memory state, re-read from disk
    _resetForTest(join(tempDir, "session-names.json"));
    expect(getNextLeaderNumber()).toBe(3);
  });

  it("counter survives alongside name operations", async () => {
    setName("s1", "Worker 1");
    const n = getNextLeaderNumber(); // 1
    expect(n).toBe(1);
    await _flushForTest();

    const raw = readFileSync(join(tempDir, "session-names.json"), "utf-8");
    const data = JSON.parse(raw);
    expect(data).toEqual({ names: { s1: "Worker 1" }, leaderCounter: 1 });
  });

  it("loads counter from old-format file as 0 (backwards compat)", () => {
    // Old format: flat Record<string, string> with no leaderCounter field
    writeFileSync(join(tempDir, "session-names.json"), JSON.stringify({ existing: "Old Session" }));
    _resetForTest(join(tempDir, "session-names.json"));
    expect(getName("existing")).toBe("Old Session");
    // Counter should start from 1 since it was 0 in old format
    expect(getNextLeaderNumber()).toBe(1);
  });
});
