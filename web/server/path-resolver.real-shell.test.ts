import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// These tests run a real login shell instead of mocking child_process. The
// mocked tests in path-resolver.test.ts feed already-formatted output to the
// parser, so they could not notice that the shell itself never printed the
// PATH: `$PATH___PATH_END___` expanded as one unset variable, and every machine
// silently fell back to the guessed directory list.

const fakeHome = vi.hoisted(() => ({ dir: "" }));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => fakeHome.dir };
});

import {
  _resetPathCache,
  _resetShellEnvCache,
  captureUserShellEnv,
  captureUserShellPath,
  getEnrichedPath,
} from "./path-resolver.js";

// A directory that only the test profile adds; it never needs to exist.
const MARKER_DIR = "/takode-test-marker/bin";
const originalEnv = { ...process.env };
const zshPath = ["/bin/zsh", "/usr/bin/zsh"].find((p) => existsSync(p));

beforeAll(() => {
  // Isolated HOME so the shell reads only the profiles these tests write.
  fakeHome.dir = mkdtempSync(join(tmpdir(), "path-resolver-shell-"));
  const profile = [`export PATH="${MARKER_DIR}:$PATH"`, 'export LITELLM_PROXY_URL="https://proxy.test"', ""].join("\n");
  writeFileSync(join(fakeHome.dir, ".bash_profile"), profile);
  writeFileSync(join(fakeHome.dir, ".zprofile"), profile);
});

afterAll(() => {
  rmSync(fakeHome.dir, { recursive: true, force: true });
});

beforeEach(() => {
  _resetPathCache();
  _resetShellEnvCache();
  process.env = { ...originalEnv };
  delete process.env.LITELLM_PROXY_URL;
});

afterEach(() => {
  process.env = originalEnv;
});

describe("captureUserShellPath with a real login shell", () => {
  it.skipIf(!existsSync("/bin/bash"))("returns the PATH set by the bash login profile", () => {
    process.env.SHELL = "/bin/bash";

    const captured = captureUserShellPath();

    expect(captured.split(":")[0]).toBe(MARKER_DIR);
  });

  it.skipIf(!zshPath)("returns the PATH set by the zsh login profile", () => {
    process.env.SHELL = zshPath;

    const captured = captureUserShellPath();

    expect(captured.split(":")[0]).toBe(MARKER_DIR);
  });

  it.skipIf(!existsSync("/bin/bash"))("warms login-shell env vars during the same capture", () => {
    process.env.SHELL = "/bin/bash";

    captureUserShellPath();

    // Env warming only runs when the PATH sentinel matched, so it was dead too.
    expect(captureUserShellEnv(["LITELLM_PROXY_URL"], { allowShellSpawn: false })).toEqual({
      LITELLM_PROXY_URL: "https://proxy.test",
    });
  });

  it.skipIf(!existsSync("/bin/bash"))("places the shell PATH after Takode's shims and before the process PATH", () => {
    process.env.SHELL = "/bin/bash";
    process.env.PATH = "/takode-test-process/bin";

    const dirs = getEnrichedPath().split(":");

    expect(dirs.slice(0, 3)).toEqual([
      join(fakeHome.dir, ".companion", "bin"),
      join(fakeHome.dir, ".local", "bin"),
      MARKER_DIR,
    ]);
    expect(dirs.at(-1)).toBe("/takode-test-process/bin");
  });
});
