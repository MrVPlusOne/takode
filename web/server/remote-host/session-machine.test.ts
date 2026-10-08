import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveGitInfo, makeDefaultState } from "../bridge/session-git-state.js";
import { FakeHostLink } from "../test-fixtures/fake-host-link.js";
import { HostAgent } from "./host-agent.js";
import { HostLinkManager, HostUnavailableError } from "./host-link-manager.js";
import { configureRemoteMachines, hostHasUsableNetwork, machineFor } from "./session-machine.js";
import { resolveFileLinkPath } from "../routes/filesystem.js";

async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * The "remote" host here is an in-process HostAgent on this machine, reached
 * only through the host link, so these tests exercise the same request path a
 * real remote machine would use.
 */
describe("session machine on a remote host", () => {
  const hostId = "host-1";
  let manager: HostLinkManager;
  let agent: HostAgent;
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "session-machine-"));
    manager = new HostLinkManager();
    configureRemoteMachines(manager);
    agent = new HostAgent({
      coordinatorUrl: "http://coordinator.test",
      token: "token",
      apiProxyPort: 45_678,
      log: () => {},
      connect: () => new FakeHostLink(manager, hostId).agentSide,
    });
    agent.start();
    await waitFor(() => manager.status(hostId).online);
  });

  afterEach(async () => {
    agent.stop();
    configureRemoteMachines(null);
    await rm(dir, { recursive: true, force: true });
  });

  // Shell commands, file reads, stat and writes run on the host and report
  // failures like local `exec`, with stdout and the exit code on the error.
  it("runs commands and file operations on the host", async () => {
    const machine = machineFor(hostId);
    expect((await machine.exec("pwd", { cwd: dir })).stdout.trim()).toMatch(/session-machine-/);
    await expect(machine.exec("echo partial; exit 3", { cwd: dir })).rejects.toMatchObject({
      code: 3,
      stdout: "partial\n",
    });

    const path = join(dir, "nested", "note.txt");
    await machine.writeFile(path, Buffer.from("hello host"));
    expect((await machine.readFile(path)).toString("utf-8")).toBe("hello host");
    expect((await machine.readFile(path, 5)).toString("utf-8")).toBe("hello");
    expect(await machine.stat(path)).toMatchObject({ size: 10, isFile: true, isDirectory: false });
    expect(await machine.stat(join(dir, "missing"))).toBeNull();
  });

  // A session's Git status is read where its files are, through the host.
  it("reads a remote session's Git state through the host", async () => {
    execFileSync("git", ["init", "-q", "-b", "trunk"], { cwd: dir });
    await writeFile(join(dir, "a.txt"), "a\n");
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init", "--allow-empty"], {
      cwd: dir,
    });
    const state = { ...makeDefaultState("session-1"), cwd: dir, host_id: hostId };
    await resolveGitInfo(state);
    expect(state.git_branch).toBe("trunk");
    expect(state.git_head_sha).toMatch(/^[0-9a-f]{40}$/);
    expect(state.git_status_refresh_error).toBeNull();
  });

  // File links in a remote session's chat resolve against the host's files, and
  // actions that only reach this machine (Finder, opening folders) are not offered.
  it("resolves a remote session's file links on the host", async () => {
    await writeFile(join(dir, "notes.md"), "# notes\n");
    const wsBridge = {
      getSession: (id: string) => (id === "session-1" ? { state: { cwd: dir, host_id: hostId } } : undefined),
    } as never;
    const target = await resolveFileLinkPath({ path: "notes.md", isRelative: true, sessionId: "session-1" }, wsBridge);
    expect(target).toMatchObject({
      absolutePath: join(dir, "notes.md"),
      exists: true,
      isFile: true,
      size: 8,
      hostId,
      canRevealInFinder: false,
      canOpenContainingFolder: false,
    });
  });

  // Requests need a connected host; an offline host fails fast instead of hanging.
  it("fails requests at once while the host is offline", async () => {
    agent.stop();
    await waitFor(() => !manager.status(hostId).online);
    await expect(machineFor(hostId).stat(dir)).rejects.toBeInstanceOf(HostUnavailableError);
    expect(hostHasUsableNetwork(hostId)).toBe(false);
  });

  // Attachment writes are ordered commands: they reach the host even when it
  // connects only later, ahead of the message that refers to them.
  it("delivers ordered file writes queued while the host was away", async () => {
    agent.stop();
    await waitFor(() => !manager.status(hostId).online);
    const path = join(dir, "attachments", "image.png");
    manager.writeFileInOrder(hostId, path, Buffer.from("png-bytes"));

    agent = new HostAgent({
      coordinatorUrl: "http://coordinator.test",
      token: "token",
      apiProxyPort: 45_678,
      log: () => {},
      connect: () => new FakeHostLink(manager, hostId).agentSide,
    });
    agent.start();
    await waitFor(() => manager.status(hostId).online);
    let content = "";
    await waitFor(() => {
      void readFile(path, "utf-8").then(
        (value) => {
          content = value;
        },
        () => {},
      );
      return content === "png-bytes";
    });
    expect(hostHasUsableNetwork(hostId)).toBe(true);
  });
});
