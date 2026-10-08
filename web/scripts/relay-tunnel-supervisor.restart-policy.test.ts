import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createFixture,
  delay,
  readStatus,
  startSupervisor,
  waitForExit,
  waitForStatus,
  registerSupervisorCleanup,
} from "./relay-tunnel-supervisor.test-helpers.js";

vi.setConfig({ testTimeout: 30_000 });
registerSupervisorCleanup();

describe("relay tunnel supervisor tracked artifacts", () => {
  it.each([
    ["exit:0", "exit_0"],
    ["exit:255", "exit_255"],
    ["signal:15", "signal_15"],
  ])(
    "classifies unexpected child behavior %s as %s",
    async (mode, expectedClass) => {
      const fixture = await createFixture(mode);
      const supervisor = startSupervisor(fixture, { maxChildExits: 1 });
      expect((await waitForExit(supervisor)).code).toBe(0);
      const status = await readStatus(fixture);
      expect(status.state).toBe("paused_test_complete");
      expect(status.exitClass).toBe(expectedClass);
    },
    30_000,
  );

  it("uses bounded backoff that grows with each quick child exit", async () => {
    const fixture = await createFixture();
    await writeFile(join(fixture.fakeState, "sequence"), "exit:255\nexit:255\nexit:255\n", "utf8");
    const fast = startSupervisor(fixture, {
      backoffs: "0.01,0.02,0.03,0.04,0.05",
      maxChildExits: 3,
    });
    expect((await waitForExit(fast)).code).toBe(0);
    const firstLog = await readFile(fixture.log, "utf8");
    expect(firstLog).toContain("backoff_seconds=0.01");
    expect(firstLog).toContain("backoff_seconds=0.02");
    expect(firstLog).toContain("backoff_seconds=0.03");
  }, 30_000);

  it("resets the attempt after a child stays up for the stable period", async () => {
    // The supervisor measures child uptime in whole seconds from just before it
    // publishes the running status. Releasing the child only after the status
    // appears and a full stable period has passed guarantees an uptime of at
    // least stableSeconds however slowly the processes start under load.
    const stableSeconds = 1;
    const stableFixture = await createFixture();
    await writeFile(join(stableFixture.fakeState, "sequence"), "await-release:255\nexit:255\n", "utf8");
    const stable = startSupervisor(stableFixture, {
      backoffs: "0.01,0.02,0.03,0.04,0.05",
      maxChildExits: 2,
      stableSeconds,
    });
    await waitForStatus(stableFixture, (status) => status.state === "running" && status.childPid !== null);
    await delay(stableSeconds * 1000 + 100);
    await writeFile(join(stableFixture.fakeState, "child-release"), "1\n", "utf8");
    const stableResult = await waitForExit(stable);
    const stableDebug = {
      result: stableResult,
      status: await readStatus(stableFixture),
      log: await readFile(stableFixture.log, "utf8"),
    };
    expect(stableResult.code, JSON.stringify(stableDebug, null, 2)).toBe(0);
    const stableLog = await readFile(stableFixture.log, "utf8");
    expect(stableLog).toContain("event=stable_child_reset");
    expect((await readStatus(stableFixture)).attempt).toBe(1);
  }, 30_000);

  it("persists wrapper start history so a launchd restart cannot reset cooldown", async () => {
    const fixture = await createFixture("exit:255");
    const sharedOptions = {
      backoffs: "0.01,0.01,0.01,0.01,0.01",
      maxChildExits: 1,
      quickStartLimit: 2,
      cooldownSeconds: 1,
    };
    const first = startSupervisor(fixture, sharedOptions);
    expect((await waitForExit(first)).code).toBe(0);

    const startedAt = Date.now();
    const second = startSupervisor(fixture, sharedOptions);
    expect((await waitForExit(second)).code).toBe(0);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(900);
    expect(await readFile(fixture.log, "utf8")).toContain("event=restart_storm_cooldown");
  }, 30_000);

  it("rate-limits a quick child restart storm before allowing retries to resume", async () => {
    const fixture = await createFixture("exit:255");
    const startedAt = Date.now();
    const supervisor = startSupervisor(fixture, {
      backoffs: "0.01,0.01,0.01,0.01,0.01",
      maxChildExits: 2,
      quickStartLimit: 2,
      cooldownSeconds: 1,
    });

    expect((await waitForExit(supervisor)).code).toBe(0);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(900);
    expect(await readFile(fixture.log, "utf8")).toContain("event=restart_storm_cooldown");
  }, 30_000);
});
