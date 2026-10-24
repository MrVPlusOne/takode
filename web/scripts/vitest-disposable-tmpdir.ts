import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Prefix of the per-run temporary directory; tests assert they run under it. */
export const DISPOSABLE_TMPDIR_PREFIX = "takode-test-tmp-";

/**
 * Vitest global setup: point TMPDIR at a fresh directory for the whole run and
 * remove it when the run ends, so temporary files that tests leave behind never
 * pile up in the machine's temp directory.
 *
 * Leftovers are not just clutter. Bun reads every entry of each directory above
 * its working directory when it starts, so once /tmp held a few hundred thousand
 * stale test directories, every CLI a test started from a temp directory spent
 * about half a second (several seconds on a busy machine) listing /tmp. Workers
 * inherit the variable, as do the processes and shell scripts tests start.
 */
export default async function setup(): Promise<() => Promise<void>> {
  const root = await realpath(await mkdtemp(join(tmpdir(), DISPOSABLE_TMPDIR_PREFIX)));
  process.env.TMPDIR = root;
  return async () => {
    await rm(root, { recursive: true, force: true });
  };
}
