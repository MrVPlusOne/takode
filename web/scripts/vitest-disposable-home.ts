import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Prefix of the per-run home directory; tests assert they run under it. */
export const DISPOSABLE_HOME_PREFIX = "takode-test-home-";

/**
 * Vitest global setup: point HOME at a fresh temporary directory for the whole
 * run so no test can read or write the developer's real home (for example
 * ~/.companion or ~/.codex). Workers inherit the variable; the directory is
 * removed when the run ends.
 */
export default async function setup(): Promise<() => Promise<void>> {
  const home = await realpath(await mkdtemp(join(tmpdir(), DISPOSABLE_HOME_PREFIX)));
  process.env.HOME = home;
  return async () => {
    await rm(home, { recursive: true, force: true });
  };
}
