import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostRegistry } from "./host-registry.js";

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
});
