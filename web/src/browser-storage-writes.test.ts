/**
 * Guard: frontend code never writes to localStorage directly.
 *
 * A full localStorage quota makes `localStorage.setItem` throw. When that write
 * sits inside a state update, the throw reaches the app's error boundary and
 * Reload doesn't help, because the full storage is still there. Every write
 * therefore goes through `setLocalStorageItem` or `scopedSetItem`
 * (utils/scoped-storage.ts), which log a failed save instead of throwing.
 *
 * This scans app source (not tests or test harnesses) for direct `setItem`
 * calls on localStorage, including `window.localStorage` and optional chaining.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const SRC_DIR = __dirname;
/** The one place allowed to call localStorage.setItem: the guarded setter itself. */
const GUARDED_SETTER_FILE = join("utils", "scoped-storage.ts");
const DIRECT_WRITE = /\blocalStorage\s*\??\.\s*setItem\s*\(/;

/** Tests and their helpers, fixtures and harnesses (`x.test.ts`, `x.test-helpers.ts`, `composer-test-utils.tsx`, `test-fixtures/`). */
function isTestCode(name: string): boolean {
  return name === "__tests__" || /\.test[.-]|^test-|-test-/.test(name);
}

function collectAppSources(dir: string, result: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!isTestCode(entry.name)) collectAppSources(full, result);
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts") && !isTestCode(entry.name)) {
      result.push(full);
    }
  }
  return result;
}

describe("browser storage writes", () => {
  it("go through the guarded setter, never localStorage.setItem directly", () => {
    const violations: string[] = [];
    for (const file of collectAppSources(SRC_DIR)) {
      const path = relative(SRC_DIR, file);
      if (path === GUARDED_SETTER_FILE) continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, index) => {
          if (DIRECT_WRITE.test(line)) violations.push(`${path}:${index + 1}: ${line.trim()}`);
        });
    }
    expect(
      violations,
      "Use setLocalStorageItem or scopedSetItem from utils/scoped-storage.ts so a full quota can't crash the app",
    ).toEqual([]);
  });

  it("detects the direct write forms it guards against", () => {
    // Keeps the scan honest: a pattern that silently stopped matching would pass the test above.
    for (const line of [
      'localStorage.setItem("k", "v");',
      'window.localStorage.setItem("k", "v");',
      'globalThis.localStorage?.setItem("k", "v");',
    ]) {
      expect(DIRECT_WRITE.test(line), line).toBe(true);
    }
    expect(DIRECT_WRITE.test('setLocalStorageItem("k", "v");')).toBe(false);
    expect(DIRECT_WRITE.test('sessionStorage.setItem("k", "v");')).toBe(false);
  });
});
