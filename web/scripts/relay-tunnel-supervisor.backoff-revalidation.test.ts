import { appendFile, mkdir, readFile, rename, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createFixture,
  expectExactForwardContract,
  findFixtureProcesses,
  pathExists,
  readStatus,
  releaseBackoffGate,
  replaceConfigValue,
  startSupervisor,
  waitForExit,
  waitForFile,
  registerSupervisorCleanup,
} from "./relay-tunnel-supervisor.test-helpers.js";

vi.setConfig({ testTimeout: 30_000 });
registerSupervisorCleanup();

describe("relay tunnel supervisor tracked artifacts", () => {
  it("pauses before child 2 when SSH config gains an extra forward during backoff", async () => {
    const fixture = await createFixture();
    await writeFile(join(fixture.fakeState, "sequence"), "exit:255\nhold\n", "utf8");
    const supervisor = startSupervisor(fixture, { backoffs: "0.01,0.01,0.01,0.01,0.01", backoffGate: true });
    await waitForFile(join(fixture.fakeState, "backoff-ready"));

    await appendFile(fixture.sshConfig, "  RemoteForward 15434 127.0.0.1:15435\n", "utf8");
    await releaseBackoffGate(fixture);
    expect((await waitForExit(supervisor)).code).toBe(0);
    const status = await readStatus(fixture);
    expect(status.state).toBe("paused_fatal");
    expect(status.exitClass).toBe("ssh_config_changed");
    expect(Number(await readFile(join(fixture.fakeState, "child-attempts"), "utf8"))).toBe(1);
    expect(await pathExists(join(fixture.fakeState, "args.2"))).toBe(false);
    expect(findFixtureProcesses(fixture.root)).toEqual([]);

    const metadata = `${JSON.stringify(status)}\n${await readFile(fixture.log, "utf8")}`;
    for (const forbidden of [
      "private-relay.example",
      "RemoteForward",
      "do-not-log-ssh-config",
      "15432",
      "15434",
      "127.0.0.1",
    ]) {
      expect(metadata).not.toContain(forbidden);
    }
  }, 30_000);

  it("pauses before child 2 when SSH config becomes a direct symlink during backoff", async () => {
    const fixture = await createFixture();
    await writeFile(join(fixture.fakeState, "sequence"), "exit:255\nhold\n", "utf8");
    const supervisor = startSupervisor(fixture, { backoffs: "0.01,0.01,0.01,0.01,0.01", backoffGate: true });
    await waitForFile(join(fixture.fakeState, "backoff-ready"));

    const original = `${fixture.sshConfig}.original`;
    await rename(fixture.sshConfig, original);
    await symlink(original, fixture.sshConfig);
    await releaseBackoffGate(fixture);
    expect((await waitForExit(supervisor)).code).toBe(0);
    expect((await readStatus(fixture)).exitClass).toBe("ssh_config_untrusted_path");
    expect(Number(await readFile(join(fixture.fakeState, "child-attempts"), "utf8"))).toBe(1);
    expect(await pathExists(join(fixture.fakeState, "args.2"))).toBe(false);
  }, 30_000);

  it("pauses before child 2 when identity ancestry becomes a symlink during backoff", async () => {
    const fixture = await createFixture();
    const identityParent = join(fixture.root, "identity-parent");
    const identityPath = join(identityParent, "identity");
    await mkdir(identityParent, { mode: 0o700 });
    await writeFile(identityPath, "disposable-test-identity\n", { mode: 0o600 });
    await replaceConfigValue(fixture, "SSH_IDENTITY_FILE", identityPath);
    await writeFile(join(fixture.fakeState, "sequence"), "exit:255\nhold\n", "utf8");
    const supervisor = startSupervisor(fixture, { backoffs: "0.01,0.01,0.01,0.01,0.01", backoffGate: true });
    await waitForFile(join(fixture.fakeState, "backoff-ready"));

    const originalParent = `${identityParent}.original`;
    await rename(identityParent, originalParent);
    await symlink(originalParent, identityParent);
    await releaseBackoffGate(fixture);
    expect((await waitForExit(supervisor)).code).toBe(0);
    expect((await readStatus(fixture)).exitClass).toBe("identity_untrusted_path");
    expect(Number(await readFile(join(fixture.fakeState, "child-attempts"), "utf8"))).toBe(1);
    expect(await pathExists(join(fixture.fakeState, "args.2"))).toBe(false);
  }, 30_000);

  it("pauses before child 2 when identity content changes during backoff", async () => {
    const fixture = await createFixture();
    await writeFile(join(fixture.fakeState, "sequence"), "exit:255\nhold\n", "utf8");
    const supervisor = startSupervisor(fixture, { backoffs: "0.01,0.01,0.01,0.01,0.01", backoffGate: true });
    await waitForFile(join(fixture.fakeState, "backoff-ready"));

    await writeFile(fixture.identity, "changed-disposable-test-identity\n", { mode: 0o600 });
    await releaseBackoffGate(fixture);
    expect((await waitForExit(supervisor)).code).toBe(0);
    expect((await readStatus(fixture)).exitClass).toBe("identity_changed");
    expect(Number(await readFile(join(fixture.fakeState, "child-attempts"), "utf8"))).toBe(1);
    expect(await pathExists(join(fixture.fakeState, "args.2"))).toBe(false);
  }, 30_000);

  it("keeps parsed runtime values stable and pauses when runtime config changes during backoff", async () => {
    const fixture = await createFixture();
    await writeFile(join(fixture.fakeState, "sequence"), "exit:255\nhold\n", "utf8");
    const supervisor = startSupervisor(fixture, { backoffs: "0.01,0.01,0.01,0.01,0.01", backoffGate: true });
    await waitForFile(join(fixture.fakeState, "backoff-ready"));

    await replaceConfigValue(fixture, "REMOTE_PORT", "15434");
    await releaseBackoffGate(fixture);
    expect((await waitForExit(supervisor)).code).toBe(0);
    expect((await readStatus(fixture)).exitClass).toBe("runtime_config_changed");
    expect(Number(await readFile(join(fixture.fakeState, "child-attempts"), "utf8"))).toBe(1);
    expect(await pathExists(join(fixture.fakeState, "args.2"))).toBe(false);
  }, 30_000);

  it("revalidates an unchanged retry and launches child 2 with the exact forward contract", async () => {
    const fixture = await createFixture();
    await writeFile(join(fixture.fakeState, "sequence"), "exit:255\nexit:255\n", "utf8");
    const supervisor = startSupervisor(fixture, {
      backoffs: "0.01,0.01,0.01,0.01,0.01",
      maxChildExits: 2,
    });

    expect((await waitForExit(supervisor)).code).toBe(0);
    expect(Number(await readFile(join(fixture.fakeState, "child-attempts"), "utf8"))).toBe(2);
    for (const attempt of [1, 2]) {
      const renderedArguments = (await readFile(join(fixture.fakeState, `args.${attempt}`), "utf8")).trim().split("\n");
      expectExactForwardContract(renderedArguments);
    }
  }, 30_000);
});
