import { spawn } from "node:child_process";
import { chmod, copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createFixture,
  findFixtureProcesses,
  pathExists,
  processIsAlive,
  processStartIdentity,
  readProcessGroup,
  readStatus,
  runningProcesses,
  startSupervisor,
  waitFor,
  waitForExit,
  waitForFile,
  waitForStatus,
  writeOwnerLock,
  registerSupervisorCleanup,
} from "./relay-tunnel-supervisor.test-helpers.js";

vi.setConfig({ testTimeout: 30_000 });
registerSupervisorCleanup();

describe("relay tunnel supervisor tracked artifacts", () => {
  it("quarantines a dead owner, rejects a live duplicate, and removes only its own token", async () => {
    const fixture = await createFixture("hold");
    const staleLock = join(fixture.state, "owner.lock");
    await writeOwnerLock(staleLock, 999999, "dead-owner", "0".repeat(64));

    const owner = startSupervisor(fixture);
    const running = await waitForStatus(fixture, (status) => status.state === "running");
    const originalToken = running.ownerToken;
    const duplicate = startSupervisor(fixture);
    const duplicateResult = await waitForExit(duplicate);

    expect(duplicateResult.code).toBe(0);
    expect(processIsAlive(owner.pid!)).toBe(true);
    expect((await readStatus(fixture)).ownerToken).toBe(originalToken);
    const quarantines = (await readdir(fixture.state)).filter((name) => name.startsWith("owner.lock.quarantine."));
    expect(quarantines).toHaveLength(1);
    expect((await stat(join(fixture.state, quarantines[0]))).mode & 0o777).toBe(0o600);
    expect(await readFile(fixture.log, "utf8")).toContain("event=live_owner_rejected");

    owner.kill("SIGTERM");
    expect((await waitForExit(owner)).code).toBe(0);
    expect(await pathExists(join(fixture.state, "owner.lock"))).toBe(false);
    expect((await readStatus(fixture)).state).toBe("stopped");
  });

  it("rejects an exact live initializing owner without signalling it", async () => {
    const fixture = await createFixture();
    const unrelated = spawn("sleep", ["30"], { stdio: "ignore" });
    runningProcesses.add(unrelated);
    await waitFor(() => processIsAlive(unrelated.pid!));
    const lock = join(fixture.state, "owner.lock");
    await writeOwnerLock(lock, unrelated.pid!, "unrelated-live-owner", processStartIdentity(unrelated.pid!));

    const contender = startSupervisor(fixture);
    expect((await waitForExit(contender)).code).toBe(0);
    expect(processIsAlive(unrelated.pid!)).toBe(true);
    expect(await readFile(lock, "utf8")).toContain("token=unrelated-live-owner\n");
  });

  it("publishes initializing ownership atomically under deterministic concurrent acquisition", async () => {
    const fixture = await createFixture("hold");
    // Hold the winner between immutable initializing publication and its ready
    // record so the contender exercises the former mkdir-before-metadata race.
    const first = startSupervisor(fixture, { ownerInitDelay: 0.1 });
    await waitForFile(join(fixture.state, "owner.lock"));
    const second = startSupervisor(fixture, { ownerContentionTicks: 5 });

    expect((await waitForExit(second)).code).toBe(0);
    await waitForStatus(fixture, (status) => status.state === "running");
    expect(Number(await waitForFile(join(fixture.fakeState, "child-attempts")))).toBe(1);
    expect(findFixtureProcesses(fixture.root)).toHaveLength(1);

    first.kill("SIGTERM");
    expect((await waitForExit(first)).code).toBe(0);
    expect(await pathExists(join(fixture.state, "owner.lock"))).toBe(false);
  });

  it("quarantines a PID-reused stale claim without signalling the unrelated process", async () => {
    const fixture = await createFixture("hold");
    const unrelated = spawn("sleep", ["30"], { stdio: "ignore" });
    runningProcesses.add(unrelated);
    await waitFor(() => processIsAlive(unrelated.pid!));
    await writeOwnerLock(join(fixture.state, "owner.lock"), unrelated.pid!, "reused-pid", "f".repeat(64));

    const supervisor = startSupervisor(fixture);
    await waitForStatus(fixture, (status) => status.state === "running");
    expect(processIsAlive(unrelated.pid!)).toBe(true);
    expect((await readdir(fixture.state)).filter((name) => name.startsWith("owner.lock.quarantine."))).toHaveLength(1);

    supervisor.kill("SIGTERM");
    expect((await waitForExit(supervisor)).code).toBe(0);
    expect(processIsAlive(unrelated.pid!)).toBe(true);
  });

  it("bounds contention on an incomplete lock without quarantine or a duplicate child", async () => {
    const fixture = await createFixture("hold");
    const incompleteLock = join(fixture.state, "owner.lock");
    await writeFile(incompleteLock, "", { mode: 0o600 });
    const supervisor = startSupervisor(fixture, { ownerContentionTicks: 2 });

    expect((await waitForExit(supervisor)).code).toBe(0);
    expect(await pathExists(incompleteLock)).toBe(true);
    expect((await readdir(fixture.state)).filter((name) => name.startsWith("owner.lock.quarantine."))).toEqual([]);
    expect(await pathExists(join(fixture.fakeState, "child-attempts"))).toBe(false);
    expect(findFixtureProcesses(fixture.root)).toEqual([]);
  });

  it("rejects token and inode replacement while preserving one live owner and exact cleanup", async () => {
    const fixture = await createFixture("hold");
    const owner = startSupervisor(fixture);
    const status = await waitForStatus(
      fixture,
      (snapshot) => snapshot.state === "running" && snapshot.healthCode === 200,
    );
    const lock = join(fixture.state, "owner.lock");
    const original = await readFile(lock, "utf8");

    // Mutate content on the same inode, then replace the pathname with a new
    // inode. Neither identity change may let a contender create a child.
    await writeFile(lock, original.replace(`token=${status.ownerToken}`, "token=replaced-token"), { mode: 0o600 });
    const tokenContender = startSupervisor(fixture);
    expect(
      (await waitForExit(tokenContender).catch((error) => Promise.reject(new Error(`token contender: ${error}`)))).code,
    ).toBe(0);
    await writeFile(lock, original, { mode: 0o600 });

    const savedLock = join(fixture.state, "owner.lock.saved");
    await rename(lock, savedLock);
    await copyFile(savedLock, lock);
    await chmod(lock, 0o600);
    const inodeContender = startSupervisor(fixture);
    expect(
      (await waitForExit(inodeContender).catch((error) => Promise.reject(new Error(`inode contender: ${error}`)))).code,
    ).toBe(0);
    await rm(lock);
    await rename(savedLock, lock);

    expect(processIsAlive(owner.pid!)).toBe(true);
    expect(findFixtureProcesses(fixture.root)).toHaveLength(1);
    owner.kill("SIGTERM");
    expect((await waitForExit(owner).catch((error) => Promise.reject(new Error(`owner stop: ${error}`)))).code).toBe(0);
    expect(await pathExists(lock)).toBe(false);
    expect(findFixtureProcesses(fixture.root)).toEqual([]);
    expect((await readdir(fixture.state)).filter((name) => name.startsWith("owner.ready."))).toEqual([]);
    expect((await readdir(fixture.state)).filter((name) => name.startsWith(".owner-claim."))).toEqual([]);
  });

  it("retains only the newest five verified stale-owner quarantines", async () => {
    const fixture = await createFixture("exit:255");
    for (let index = 0; index < 7; index += 1) {
      await writeFile(join(fixture.state, `owner.lock.quarantine.000000000${index}.retained`), `stale=${index}\n`, {
        mode: 0o600,
      });
    }
    await writeOwnerLock(join(fixture.state, "owner.lock"), 900001, "new-stale", "0".repeat(64));
    const supervisor = startSupervisor(fixture, { maxChildExits: 1, quickStartLimit: 99, quarantineLimit: 5 });
    expect((await waitForExit(supervisor)).code).toBe(0);
    const quarantines = (await readdir(fixture.state)).filter((name) => name.startsWith("owner.lock.quarantine."));
    expect(quarantines).toHaveLength(5);
    for (const name of quarantines) expect((await stat(join(fixture.state, name))).mode & 0o777).toBe(0o600);
  }, 60_000);

  it("records a verified child process-group handshake before exact deliberate cleanup", async () => {
    for (let iteration = 0; iteration < 1; iteration += 1) {
      const fixture = await createFixture("hold-with-child");
      const supervisor = startSupervisor(fixture);
      const status = await waitForStatus(fixture, (snapshot) => snapshot.state === "running");
      expect(status.childPid).toBeTypeOf("number");
      expect(status.childPgid).toBe(status.childPid);
      expect(readProcessGroup(status.childPid!)).toBe(status.childPgid);
      const nestedPid = Number(await waitForFile(join(fixture.fakeState, "nested-pid")));

      supervisor.kill("SIGTERM");
      expect((await waitForExit(supervisor)).code).toBe(0);
      expect(processIsAlive(status.childPid!)).toBe(false);
      expect(processIsAlive(nestedPid)).toBe(false);
      expect((await readStatus(fixture)).exitClass).toBe("deliberate_stop");
    }
  }, 30_000);

  it("exits nonzero and leaves no child or lock when the PGID handshake fails", async () => {
    const fixture = await createFixture("hold");
    const supervisor = startSupervisor(fixture, { handshakeFail: true, handshakeTicks: 3 });
    const result = await waitForExit(supervisor);
    const status = await readStatus(fixture);

    expect(result.code).toBe(70);
    expect(status.state).toBe("crashed");
    expect(status.exitClass).toBe("wrapper_error");
    expect(await pathExists(join(fixture.state, "owner.lock"))).toBe(false);
    expect(findFixtureProcesses(fixture.root)).toEqual([]);
  }, 30_000);
});
