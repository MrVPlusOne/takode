import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostRegistry } from "../remote-host/host-registry.js";
import { resolveRemoteHostForCreate } from "./session-remote-host.js";

const fail = (message: string): never => {
  throw new Error(message);
};

describe("resolveRemoteHostForCreate", () => {
  let dir: string;
  let registry: HostRegistry;
  let hostId: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "session-remote-host-"));
    registry = new HostRegistry(join(dir, "hosts.json"));
    hostId = (await registry.register("devbox")).host.id;
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const resolve = (body: Record<string, unknown>, cwd?: string) =>
    resolveRemoteHostForCreate({ body, cwd, registry, fail });

  // Sessions without a host stay on this machine; a registered host with an
  // absolute path on that host is accepted without checking the local disk.
  it("returns the host for a valid remote request and nothing for a local one", async () => {
    expect(await resolve({})).toBeUndefined();
    expect(await resolve({ hostId }, "/path/that/exists/only/on/the/host")).toBe(hostId);
    // Worktree sessions are created on the host itself.
    expect(await resolve({ hostId, useWorktree: true }, "/srv/repo")).toBe(hostId);
  });

  // Anything not yet supported remotely is refused rather than silently run on this machine.
  it("refuses unknown hosts and unsupported remote options", async () => {
    const cwd = "/srv/repo";
    await expect(resolve({ hostId: "missing" }, cwd)).rejects.toThrow("Unknown host");
    await expect(resolve({ hostId, assistantMode: true }, cwd)).rejects.toThrow("Assistant mode");
    await expect(resolve({ hostId }, "relative/path")).rejects.toThrow("absolute working directory");
    await expect(resolve({ hostId }, undefined)).rejects.toThrow("absolute working directory");
  });
});
