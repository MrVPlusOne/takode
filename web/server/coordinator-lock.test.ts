import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claimCoordinatorEpoch, type CoordinatorHolder } from "./coordinator-lock.js";

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
