import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname } from "node:path";

/** Who holds a coordinator's state: the latest server process to start for it. */
export interface CoordinatorHolder {
  /** Start counter; every start of this coordinator takes the next number. */
  epoch: number;
  pid: number;
  hostname: string;
  startedAt: number;
}

const POLL_MS = 5_000;

/**
 * Keep one running coordinator per server identity. Each start takes the next
 * epoch in the lock file. A coordinator that later finds another holder there
 * has been replaced, for example by a restart while it lingered without its
 * listening socket, and must stop at once without writing shared state.
 * Hosts refuse a coordinator whose epoch is older than one they have seen, so
 * a replaced coordinator also cannot drive their processes.
 */
export async function claimCoordinatorEpoch(options: {
  path: string;
  /** Called once when another process has taken over. */
  onSuperseded: (holder: CoordinatorHolder) => void;
  pollMs?: number;
}): Promise<{ epoch: number; stop: () => void }> {
  const previous = await readHolder(options.path);
  const mine: CoordinatorHolder = {
    epoch: (previous?.epoch ?? 0) + 1,
    pid: process.pid,
    hostname: hostname(),
    startedAt: Date.now(),
  };
  await mkdir(dirname(options.path), { recursive: true });
  const temp = `${options.path}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(mine, null, 2));
  await rename(temp, options.path);

  let stopped = false;
  const timer = setInterval(() => {
    void readHolder(options.path).then((holder) => {
      // A missing or unreadable file is not a takeover; a different holder is.
      if (stopped || !holder || (holder.epoch === mine.epoch && holder.pid === mine.pid)) return;
      stopped = true;
      clearInterval(timer);
      options.onSuperseded(holder);
    });
  }, options.pollMs ?? POLL_MS);
  timer.unref?.();
  return {
    epoch: mine.epoch,
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}

async function readHolder(path: string): Promise<CoordinatorHolder | null> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf-8")) as Partial<CoordinatorHolder>;
    return Number.isInteger(parsed.epoch) && Number.isInteger(parsed.pid) ? (parsed as CoordinatorHolder) : null;
  } catch {
    return null;
  }
}
