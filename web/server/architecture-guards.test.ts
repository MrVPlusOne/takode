/**
 * Architecture guards — enforce structural rules that prevent performance
 * regressions on NFS-mounted home directories.
 *
 * These tests scan server source files for forbidden patterns. They run as
 * part of the normal test suite, so violations are caught before code can
 * be synced to main.
 *
 * Escape hatches:
 * - `// sync-ok` on the same line or within 2 lines of a sync call suppresses it.
 *   Use for documented cold-path-only calls (e.g. mkdirSync in constructors).
 * - `// sync-ok-file` anywhere in the file suppresses ALL sync violations for
 *   that file. Use only for files that are entirely CLI-only and never imported
 *   by the server's hot path (e.g. migration.ts, service.ts).
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SERVER_DIR = join(__dirname);

/** Recursively collect all .ts files under a directory, excluding test files. */
function collectSourceFiles(dir: string, result: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(full, result);
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".d.ts")) {
      result.push(full);
    }
  }
  return result;
}

// Sync fs/child_process calls that block the event loop on NFS.
// mkdirSync is intentionally excluded — it's acceptable in constructors/startup.
const FORBIDDEN_SYNC_CALLS = [
  "readFileSync",
  "writeFileSync",
  "appendFileSync",
  "existsSync",
  "statSync",
  "lstatSync",
  "accessSync",
  "renameSync",
  "unlinkSync",
  "copyFileSync",
  "readdirSync",
  "chmodSync",
  "utimesSync",
  "rmSync",
  "execSync",
  "spawnSync",
  "execFileSync",
  "mkdtempSync",
  "opendirSync",
  "openSync",
  "closeSync",
  "truncateSync",
];

const FORBIDDEN_PATTERN = new RegExp(`\\b(${FORBIDDEN_SYNC_CALLS.join("|")})\\b`);

/** Number of surrounding lines to check for a `// sync-ok` annotation. */
const SYNC_OK_WINDOW = 2;

interface Violation {
  file: string;
  line: number;
  text: string;
  match: string;
}

/**
 * Check whether any line within a window around `lineIndex` contains `// sync-ok`.
 * This handles formatters that move inline comments to adjacent lines.
 */
function hasSyncOkNearby(lines: string[], lineIndex: number): boolean {
  const start = Math.max(0, lineIndex - SYNC_OK_WINDOW);
  const end = Math.min(lines.length - 1, lineIndex + SYNC_OK_WINDOW);
  for (let j = start; j <= end; j++) {
    if (lines[j].includes("// sync-ok")) return true;
  }
  return false;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Architecture Guards", () => {
  it("server code must not use synchronous file/process I/O (blocks event loop on NFS)", () => {
    const files = collectSourceFiles(SERVER_DIR);
    const violations: Violation[] = [];

    for (const filePath of files) {
      const content = readFileSync(filePath, "utf-8");

      // File-level opt-out for entirely CLI-only modules
      if (content.includes("// sync-ok-file")) continue;

      const lines = content.split("\n");
      let inBlockComment = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        // Track multi-line block comments
        if (inBlockComment) {
          if (trimmed.includes("*/")) inBlockComment = false;
          continue;
        }
        if (trimmed.startsWith("/*")) {
          if (!trimmed.includes("*/")) inBlockComment = true;
          continue;
        }

        // Skip lines with the escape hatch comment nearby (handles formatters
        // that move inline comments to adjacent lines)
        if (hasSyncOkNearby(lines, i)) continue;

        // Skip single-line comments
        if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

        // Skip import/require lines. Imports are multi-line so we track
        // whether we're inside an import block.
        if (trimmed.startsWith("import ") || trimmed.startsWith("import{")) {
          // Multi-line import — skip until closing "from" line
          if (!trimmed.includes(" from ") || !trimmed.endsWith(";")) {
            while (i < lines.length - 1 && !lines[i].includes(" from ")) i++;
          }
          continue;
        }
        // Catch continuation lines of multi-line imports (bare identifiers, "} from")
        if (trimmed.startsWith("} from ") || trimmed.startsWith("require(") || /^(const|let|var)\s+\{/.test(trimmed))
          continue;

        const match = FORBIDDEN_PATTERN.exec(line);
        if (match) {
          violations.push({
            file: relative(SERVER_DIR, filePath),
            line: i + 1,
            text: line.trim(),
            match: match[1],
          });
        }
      }
    }

    if (violations.length > 0) {
      const report = violations.map((v) => `  ${v.file}:${v.line}: ${v.match}\n    ${v.text}`).join("\n");
      expect.fail(
        `\nSync file/process I/O detected in server code (blocks event loop on NFS):\n\n${report}\n\n` +
          `Add '// sync-ok' comment near the call, or '// sync-ok-file' at the top of the file\n` +
          `if this is a documented cold-path-only module.\n` +
          `See CLAUDE.md "Never use synchronous file I/O" section for async patterns.`,
      );
    }
  });
});
