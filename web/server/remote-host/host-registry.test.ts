import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostRegistry, LOCAL_HOST_ID } from "./host-registry.js";

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
    await expect(registry.register("bad name")).rejects.toThrow("Host names use letters");
    await registry.register("laptop");
    await expect(registry.register("laptop")).rejects.toThrow("already exists");
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
  // never overwrites what the user has set since.
  it("adopts the old global binaries as this machine's settings only once", async () => {
    const path = join(dir, "hosts.json");
    const registry = new HostRegistry(path);
    expect(await registry.adoptLegacyLocalSettings(null)).toBe(false);
    expect(await registry.adoptLegacyLocalSettings({ claudeBinary: "/old/claude", codexBinary: "" })).toBe(true);
    expect(registry.machineSettings(LOCAL_HOST_ID).claudeBinary).toBe("/old/claude");

    await registry.updateMachineSettings(LOCAL_HOST_ID, { claudeBinary: "/new/claude" });
    const reloaded = new HostRegistry(path);
    expect(await reloaded.adoptLegacyLocalSettings({ claudeBinary: "/old/claude", codexBinary: "" })).toBe(true);
    expect(reloaded.machineSettings(LOCAL_HOST_ID).claudeBinary).toBe("/new/claude");
  });
});
