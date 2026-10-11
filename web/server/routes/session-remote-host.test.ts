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

  // Folders that exist on the fake host; the real check asks the host over its link.
  const hostFolders = new Set(["/path/that/exists/only/on/the/host", "/srv/repo"]);
  const folderExists = async (_hostId: string, path: string) => hostFolders.has(path);
  const resolve = (body: Record<string, unknown>, cwd?: string) =>
    resolveRemoteHostForCreate({ body, cwd, registry, fail, folderExists });

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

  // A host that cannot start the session's process now is refused at once with
  // a 503 naming it, instead of a create that waits for the host: offline, or
  // restarting for an update that may never finish.
  it("refuses a host that cannot start a process now", async () => {
    let status: number | undefined;
    const failWithStatus = (message: string, code: number): never => {
      status = code;
      throw new Error(message);
    };
    const blocked = (blocker: string | null) =>
      resolveRemoteHostForCreate({
        body: { hostId },
        cwd: "/srv/repo",
        registry,
        fail: failWithStatus,
        startBlocker: () => blocker,
        folderExists,
      });
    await expect(blocked("is restarting for a Takode update; try again once it is back")).rejects.toThrow(
      "Host devbox is restarting for a Takode update; try again once it is back",
    );
    expect(status).toBe(503);
    await expect(blocked("is offline")).rejects.toThrow("Host devbox is offline");
    expect(await blocked(null)).toBe(hostId);
  });

  // A folder that is not on the host (for example a path remembered on another
  // machine) is refused before the session is created, naming the host, and a
  // host that cannot be asked is reported rather than treated as a missing folder.
  it("refuses a working directory that is not a folder on the host", async () => {
    let status: number | undefined;
    const failWithStatus = (message: string, code: number): never => {
      status = code;
      throw new Error(message);
    };
    await expect(resolve({ hostId }, "/Users/someone/Code/app")).rejects.toThrow(
      "Directory does not exist on devbox: /Users/someone/Code/app",
    );
    await expect(
      resolveRemoteHostForCreate({
        body: { hostId },
        cwd: "/srv/repo",
        registry,
        fail: failWithStatus,
        startBlocker: () => null,
        folderExists: async () => {
          throw new Error("link timed out");
        },
      }),
    ).rejects.toThrow("Could not check /srv/repo on host devbox: link timed out");
    expect(status).toBe(503);
  });
});
