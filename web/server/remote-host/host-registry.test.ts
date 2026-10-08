import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostRegistry, LOCAL_HOST_ID, processHostOf } from "./host-registry.js";

describe("HostRegistry", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "host-registry-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // A host proves itself with the token issued at registration. Only a hash is
  // stored, a fresh registry instance reads it back, and removal revokes it.
  it("issues a one-time token, stores only its hash, authenticates and revokes", async () => {
    const path = join(dir, "hosts.json");
    const registry = new HostRegistry(path);
    const { host, token } = await registry.register("build-box");

    const stored = await readFile(path, "utf-8");
    expect(stored).not.toContain(token);
    expect(stored).toContain("build-box");

    const reloaded = new HostRegistry(path);
    expect(await reloaded.authenticate(token)).toEqual(host);
    expect(await reloaded.authenticate("not-the-token")).toBeNull();
    expect(await reloaded.list()).toEqual([host]);

    expect(await reloaded.remove(host.id)).toBe(true);
    expect(await reloaded.authenticate(token)).toBeNull();
  });

  it("rejects invalid and duplicate host names", async () => {
    const registry = new HostRegistry(join(dir, "hosts.json"));
    await expect(registry.register("bad name")).rejects.toThrow("Machine names use letters");
    await registry.register("laptop");
    await expect(registry.register("laptop")).rejects.toThrow("already exists");
    // The coordinator's own machine is not registered, but its name is taken too.
    await expect(registry.register("coordinator-box", ["coordinator-box"])).rejects.toThrow("already exists");
  });

  // A machine's name belongs to the machine: renames are validated against
  // every other machine, and a connecting host's own name replaces the
  // registration name unless it is taken or invalid.
  it("renames hosts and adopts the name a host reports", async () => {
    const path = join(dir, "hosts.json");
    const registry = new HostRegistry(path);
    const { host } = await registry.register("devbox");
    const { host: other } = await registry.register("gpu-box");

    await expect(registry.rename(host.id, "gpu-box")).rejects.toThrow("already exists");
    await expect(registry.rename(host.id, "laptop", ["laptop"])).rejects.toThrow("already exists");
    expect(await registry.rename("missing", "anything")).toBe(false);
    expect(await registry.rename(host.id, "build-box")).toBe(true);
    expect(registry.nameOf(host.id)).toBe("build-box");

    // No stored name on the host, or the same one: nothing changes.
    expect(registry.adoptReportedName(host.id, null)).toBe("build-box");
    // Taken by another host or by this machine: the registry keeps its name.
    expect(registry.adoptReportedName(host.id, registry.nameOf(other.id))).toBe("build-box");
    expect(registry.adoptReportedName(host.id, "laptop", ["laptop"])).toBe("build-box");
    expect(registry.adoptReportedName(host.id, "bad name")).toBe("build-box");
    // A usable name the machine already has wins and is saved.
    expect(registry.adoptReportedName(host.id, "old-laptop")).toBe("old-laptop");
    await registry.rename(other.id, "gpu-box"); // waits for earlier writes
    const reloaded = new HostRegistry(path);
    expect((await reloaded.get(host.id))?.name).toBe("old-laptop");
  });

  // Each machine, including this one, has its own Claude/Codex settings; they
  // persist, are trimmed, and go away with a removed host.
  it("stores machine settings per host and for this machine", async () => {
    const path = join(dir, "hosts.json");
    const registry = new HostRegistry(path);
    const { host } = await registry.register("gpu-box");
    expect(registry.machineSettings(host.id)).toEqual({ claudeBinary: "", codexBinary: "" });

    await registry.updateMachineSettings(host.id, { claudeBinary: " /opt/claude " });
    await registry.updateMachineSettings(LOCAL_HOST_ID, { codexBinary: "/usr/local/bin/codex" });
    expect(await registry.updateMachineSettings("missing", { claudeBinary: "x" })).toBeNull();

    const reloaded = new HostRegistry(path);
    await reloaded.load();
    expect(reloaded.machineSettings(host.id)).toEqual({ claudeBinary: "/opt/claude", codexBinary: "" });
    expect(reloaded.machineSettings(LOCAL_HOST_ID)).toEqual({ claudeBinary: "", codexBinary: "/usr/local/bin/codex" });

    await reloaded.remove(host.id);
    expect(reloaded.machineSettings(host.id)).toEqual({ claudeBinary: "", codexBinary: "" });
  });

  // The old global binaries become this machine's settings once; a later start
  // never overwrites what is stored since. The answer says whether the caller
  // may delete its old copy: only when that copy is what this machine now has.
  it("adopts the old global binaries as this machine's settings only once", async () => {
    const path = join(dir, "hosts.json");
    const registry = new HostRegistry(path);
    expect(await registry.adoptLegacyLocalSettings(null)).toBe(false);
    expect(await registry.adoptLegacyLocalSettings({ claudeBinary: " /old/claude ", codexBinary: "" })).toBe(true);
    expect(registry.machineSettings(LOCAL_HOST_ID).claudeBinary).toBe("/old/claude");
    // The same values again (e.g. the delete failed last time) may be dropped.
    expect(await registry.adoptLegacyLocalSettings({ claudeBinary: "/old/claude", codexBinary: "" })).toBe(true);

    await registry.updateMachineSettings(LOCAL_HOST_ID, { claudeBinary: "/new/claude" });
    const reloaded = new HostRegistry(path);
    expect(await reloaded.adoptLegacyLocalSettings({ claudeBinary: "/old/claude", codexBinary: "" })).toBe(false);
    expect(reloaded.machineSettings(LOCAL_HOST_ID).claudeBinary).toBe("/new/claude");
  });

  // Settings files are per port but this registry is per server id, so two
  // ports' files can share it. The second file's different values must not be
  // reported as moved, or its server would delete them without storing them.
  it("does not claim another settings file's different values as moved", async () => {
    const path = join(dir, "hosts.json");
    expect(
      await new HostRegistry(path).adoptLegacyLocalSettings({
        claudeBinary: "/port-a/claude",
        codexBinary: "/port-a/codex",
      }),
    ).toBe(true);
    const secondServer = new HostRegistry(path);
    expect(
      await secondServer.adoptLegacyLocalSettings({
        claudeBinary: "/port-b/claude-copilot",
        codexBinary: "/port-a/codex",
      }),
    ).toBe(false);
    expect(secondServer.machineSettings(LOCAL_HOST_ID)).toEqual({
      claudeBinary: "/port-a/claude",
      codexBinary: "/port-a/codex",
    });
  });

  // This machine's node authenticates as the local host with a token the
  // server issues for it (stored only as a hash); a new token replaces the old
  // one. Turning the node on persists and keeps this machine's other settings.
  it("stores this machine's node setting and authenticates its token", async () => {
    const path = join(dir, "hosts.json");
    const registry = new HostRegistry(path);
    await registry.updateMachineSettings(LOCAL_HOST_ID, {
      claudeBinary: "/opt/claude",
    });
    expect(registry.localNodeEnabled()).toBe(false);
    await registry.setLocalNodeEnabled(true);
    const first = await registry.issueLocalNodeToken();
    expect(await readFile(path, "utf-8")).not.toContain(first);

    const reloaded = new HostRegistry(path);
    expect(await reloaded.authenticate(first)).toMatchObject({
      id: LOCAL_HOST_ID,
    });
    expect(reloaded.localNodeEnabled()).toBe(true);
    expect(reloaded.machineSettings(LOCAL_HOST_ID).claudeBinary).toBe("/opt/claude");
    expect(await reloaded.list()).toEqual([]);

    const second = await reloaded.issueLocalNodeToken();
    expect(await reloaded.authenticate(first)).toBeNull();
    expect(await reloaded.authenticate(second)).toMatchObject({
      id: LOCAL_HOST_ID,
    });
  });

  // A session's process runs under a node when it has a remote host, or when a
  // session without one saved a host process id (this machine's node).
  it("names the host whose node runs a session's process", () => {
    expect(processHostOf({ hostId: "gpu-box", hostProcId: "p" })).toBe("gpu-box");
    expect(processHostOf({ hostProcId: "p" })).toBe(LOCAL_HOST_ID);
    expect(processHostOf({})).toBeUndefined();
  });
});
