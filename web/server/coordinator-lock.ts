import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { dirname, join } from "node:path";

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

/** Epoch file of a coordinator in a Takode home: the latest start of server `serverId`. */
export function coordinatorLockPath(serverId: string, home = homedir()): string {
  return join(home, ".companion", "coordinator", `${serverId}.json`);
}

/** The latest epoch recorded for a coordinator, 0 when it never started. */
export async function readCoordinatorEpoch(lockPath: string): Promise<number> {
  return (await readHolder(lockPath))?.epoch ?? 0;
}

/**
 * Make the next start of a coordinator take an epoch above `epoch`, as when
 * its state arrives from another machine whose hosts have seen that epoch.
 * Only for a stopped coordinator: a running one would take this as a takeover.
 */
export async function raiseCoordinatorEpoch(lockPath: string, epoch: number): Promise<void> {
  if ((await readCoordinatorEpoch(lockPath)) >= epoch) return;
  const holder: CoordinatorHolder = { epoch, pid: 0, hostname: "", startedAt: 0 };
  await mkdir(dirname(lockPath), { recursive: true });
  const temp = `${lockPath}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(holder, null, 2));
  await rename(temp, lockPath);
}

/** Where a coordinator went after it was handed off to another machine. */
export interface CoordinatorMove {
  /** Name of the machine that runs the coordinator now. */
  machine: string;
  /** Where to open it. */
  address: string;
  movedAt: number;
}

/**
 * The fence a coordinator's old machine keeps after a handoff: while it
 * exists, a server with this identity refuses to start there, because two
 * coordinators with one identity would split quests, memory and sessions.
 */
export function coordinatorMovePath(serverId: string, home = homedir()): string {
  return join(home, ".companion", "coordinator", `${serverId}.moved.json`);
}

export async function readCoordinatorMove(movePath: string): Promise<CoordinatorMove | null> {
  try {
    const parsed = JSON.parse(await readFile(movePath, "utf-8")) as Partial<CoordinatorMove>;
    if (typeof parsed.machine === "string" && typeof parsed.address === "string") return parsed as CoordinatorMove;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
  }
  // An unreadable fence still fences: refusing to start is the safe side.
  return { machine: "another machine", address: `unknown (could not read ${movePath})`, movedAt: 0 };
}

export async function writeCoordinatorMove(movePath: string, move: CoordinatorMove): Promise<void> {
  await mkdir(dirname(movePath), { recursive: true });
  const temp = `${movePath}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(move, null, 2));
  await rename(temp, movePath);
}

/** What a fenced server prints instead of starting. */
export function coordinatorMovedMessage(move: CoordinatorMove, reclaimCommand: string): string {
  const when = move.movedAt ? ` on ${new Date(move.movedAt).toISOString()}` : "";
  return (
    `This Takode server moved to ${move.machine}${when}; open it at ${move.address}.\n` +
    "It will not start here, so the two machines cannot both change its quests, memory and sessions.\n" +
    `To run it on this machine again (only after stopping it on ${move.machine}): ${reclaimCommand}`
  );
}

/**
 * Let a handed-off coordinator start on this machine again: keep the fence as
 * a dated copy for the record, and make the next start's epoch exceed
 * `afterEpoch` (the epoch the other machine reached), since hosts that
 * followed the coordinator there refuse a lower one.
 */
export async function reclaimCoordinator(options: {
  lockPath: string;
  movePath: string;
  afterEpoch?: number;
  now?: Date;
}): Promise<{ wasMoved: boolean }> {
  if (options.afterEpoch) await raiseCoordinatorEpoch(options.lockPath, options.afterEpoch);
  try {
    const stamp = (options.now ?? new Date()).toISOString().replace(/[:.]/g, "-");
    await rename(options.movePath, `${options.movePath}.reclaimed-${stamp}`);
    return { wasMoved: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { wasMoved: false };
    throw error;
  }
}
