import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  claimCoordinatorEpoch,
  coordinatorLockPath,
  coordinatorMovePath,
  readCoordinatorMove,
  reclaimCoordinator,
  writeCoordinatorMove,
  type CoordinatorHolder,
} from "./coordinator-lock.js";

async function waitFor(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("claimCoordinatorEpoch", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "coordinator-lock-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // Each start takes the next epoch, and the process it replaced learns that it
  // must stop. The second claim stands in for a later start of the same server
  // (same pid here, but a newer epoch).
  it("counts starts and tells the replaced coordinator to stop", async () => {
    const path = join(dir, "coordinator", "server-1.json");
    const superseded: CoordinatorHolder[] = [];
    const first = await claimCoordinatorEpoch({ path, pollMs: 20, onSuperseded: (holder) => superseded.push(holder) });
    expect(first.epoch).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(superseded).toEqual([]);

    const second = await claimCoordinatorEpoch({ path, pollMs: 20, onSuperseded: () => {} });
    second.stop();
    expect(second.epoch).toBe(2);
    await waitFor(() => superseded.length === 1);
    expect(superseded[0]).toMatchObject({ epoch: 2 });
    expect(JSON.parse(await readFile(path, "utf-8"))).toMatchObject({ epoch: 2, pid: process.pid });
    first.stop();
  });
});

describe("handed-off coordinators", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "coordinator-move-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // Reclaiming lifts the fence (keeping it as a record) and makes the next
  // start's epoch exceed the one the other machine reached, because hosts that
  // followed the coordinator there refuse a lower epoch.
  it("lets a reclaimed coordinator start again above the other machine's epoch", async () => {
    const lockPath = coordinatorLockPath("server-1", dir);
    const movePath = coordinatorMovePath("server-1", dir);
    expect(await readCoordinatorMove(movePath)).toBeNull();
    const move = { machine: "devbox", address: "https://takode.example", movedAt: 1 };
    await writeCoordinatorMove(movePath, move);
    expect(await readCoordinatorMove(movePath)).toEqual(move);

    expect(await reclaimCoordinator({ lockPath, movePath, afterEpoch: 9 })).toEqual({ wasMoved: true });
    expect(await readCoordinatorMove(movePath)).toBeNull();
    expect((await readdir(join(dir, ".companion", "coordinator"))).some((name) => name.includes(".reclaimed-"))).toBe(
      true,
    );
    const lock = await claimCoordinatorEpoch({ path: lockPath, onSuperseded: () => {} });
    lock.stop();
    expect(lock.epoch).toBe(10);
  });

  // A fence that cannot be read must still keep the server from starting.
  it("treats an unreadable fence as a fence", async () => {
    const movePath = coordinatorMovePath("server-1", dir);
    await mkdir(join(movePath, ".."), { recursive: true });
    await writeFile(movePath, "{not json");
    expect(await readCoordinatorMove(movePath)).toMatchObject({ machine: "another machine" });
  });
});
