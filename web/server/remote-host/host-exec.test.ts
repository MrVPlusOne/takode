import { mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { HostAgent } from "./host-agent.js";
import { HostExec, HostExecError, type HostExecDeps } from "./host-exec.js";
import { HostLinkManager } from "./host-link-manager.js";
import { FakeHostLink } from "../test-fixtures/fake-host-link.js";
import { HOST_EXEC_MESSAGE_TAG } from "../../shared/host-exec.js";

const HOST_ID = "host-1";

async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 8_000): Promise<void> {
  const started = Date.now();
  while (!(await condition())) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/**
 * `takode exec` end to end inside one process: a real HostAgent runs the
 * commands with /bin/sh over an in-memory host link, and HostExec records them
 * in a temporary folder.
 */
describe("HostExec", () => {
  let manager: HostLinkManager;
  let agent: HostAgent | null;
  let links: FakeHostLink[];
  let dir: string;
  let notices: Array<{ sessionId: string; text: string }>;
  let changed: string[];
  const savedShell = process.env.SHELL;

  beforeAll(() => {
    // The login shell runs the command; a plain sh keeps the user's profile out of the test.
    process.env.SHELL = "/bin/sh";
  });

  afterAll(() => {
    process.env.SHELL = savedShell;
  });

  beforeEach(async () => {
    manager = new HostLinkManager();
    links = [];
    notices = [];
    changed = [];
    dir = await mkdtemp(join(tmpdir(), "host-exec-"));
  });

  afterEach(async () => {
    agent?.stop();
    agent = null;
    await rm(dir, { recursive: true, force: true });
  });

  function connectHost(): void {
    agent = new HostAgent({
      coordinatorUrl: "http://coordinator.test",
      token: "token",
      apiProxyPort: 45_678,
      reconnectDelayMs: 20,
      log: () => {},
      connect: () => {
        const link = new FakeHostLink(manager, HOST_ID);
        links.push(link);
        return link.agentSide;
      },
    });
    agent.start();
  }

  function createExec(overrides: Partial<HostExecDeps> = {}): HostExec {
    return new HostExec({
      links: manager,
      resolveHost: async (name) => (name === "condor" || name === HOST_ID ? { id: HOST_ID, name: "condor" } : null),
      machineNames: async () => ["devbox", "condor"],
      execDisabled: () => false,
      notify: (sessionId, text) => notices.push({ sessionId, text }),
      onSessionChange: (sessionId) => changed.push(sessionId),
      dir,
      ...overrides,
    });
  }

  const run = (exec: HostExec, command: string, extra: { background?: boolean; cwd?: string } = {}) =>
    exec.start({
      sessionId: "session-a",
      sessionNum: 7,
      questId: "q-1",
      host: "condor",
      command,
      background: extra.background ?? false,
      ...(extra.cwd ? { cwd: extra.cwd } : {}),
    });

  async function finished(exec: HostExec, id: string) {
    await waitFor(async () => (await exec.wait(id, 500))?.status !== "running");
    return exec.get(id)!;
  }

  // The basic contract: output (stdout and stderr together) and the exit code
  // come back, the call is recorded with its session and quest, and a
  // foreground caller that kept asking is not sent a message.
  it("runs a foreground command and records its outcome and output", async () => {
    connectHost();
    await waitFor(() => manager.status(HOST_ID).online);
    const exec = createExec();
    const started = await run(exec, "echo out; echo err >&2; exit 3");
    expect(started).toMatchObject({ id: "x-1", host: "condor", status: "running", sessionNum: 7, questId: "q-1" });
    const job = await finished(exec, started.id);
    expect(job).toMatchObject({ status: "exited", exitCode: 3, signal: null, background: false });
    expect(job.endedAt).not.toBeNull();
    const output = await exec.readOutput(job.id, { readerSessionId: "session-a" });
    expect(output?.output.split("\n").sort()).toEqual(["", "err", "out"]);
    expect(notices).toEqual([]);
    // Start and end both refresh the session's waits.
    expect(changed).toEqual(["session-a", "session-a"]);
    // The record survives on disk for the audit trail.
    const stored = JSON.parse(await readFile(join(dir, "jobs.json"), "utf-8"));
    expect(stored.jobs[0]).toMatchObject({ id: "x-1", command: "echo out; echo err >&2; exit 3", exitCode: 3 });
  });

  // Commands run in the host user's home unless told otherwise; a leading ~ is
  // that home too, resolved by the host's shell, and a missing folder fails
  // with the shell's own message.
  it("runs in the host user's home or the folder given", async () => {
    connectHost();
    await waitFor(() => manager.status(HOST_ID).online);
    const exec = createExec();
    const inHome = await finished(exec, (await run(exec, "pwd")).id);
    expect((await exec.readOutput(inHome.id, { readerSessionId: "session-a" }))?.output.trim()).toBe(homedir());
    const tilde = await finished(exec, (await run(exec, "pwd", { cwd: "~" })).id);
    expect(tilde.cwd).toBe("~");
    expect((await exec.readOutput(tilde.id, { readerSessionId: "session-a" }))?.output.trim()).toBe(homedir());
    const given = await finished(exec, (await run(exec, "pwd", { cwd: dir })).id);
    expect((await exec.readOutput(given.id, { readerSessionId: "session-a" }))?.output.trim()).toBe(dir);
    const missing = await finished(exec, (await run(exec, "pwd", { cwd: join(dir, "missing") })).id);
    expect(missing).toMatchObject({ status: "exited", exitCode: 1 });
    expect((await exec.readOutput(missing.id, { readerSessionId: "session-a" }))?.output).toContain("missing");
  });

  // A background command tells its session when it ends, with the outcome and
  // the last lines of output, and counts as a background job meanwhile.
  it("tells the session when a background command finishes", async () => {
    connectHost();
    await waitFor(() => manager.status(HOST_ID).online);
    const exec = createExec();
    const started = await run(exec, "for i in 1 2 3; do echo line$i; done; sleep 0.3", { background: true });
    expect(exec.backgroundTasks("session-a")?.tasks).toEqual([
      expect.objectContaining({ taskId: started.id, description: expect.stringContaining("takode exec on condor") }),
    ]);
    await waitFor(() => notices.length === 1);
    const [notice] = notices;
    expect(notice!.sessionId).toBe("session-a");
    expect(notice!.text.startsWith(`${HOST_EXEC_MESSAGE_TAG} x-1 on condor: exit 0 after`)).toBe(true);
    expect(notice!.text).toContain("line1\nline2\nline3");
    expect(notice!.text).toContain("takode exec logs x-1");
    expect(exec.backgroundTasks("session-a")?.tasks).toEqual([]);
  });

  // A foreground caller that was killed never collects the result, so the
  // session is sent it like for a background command; one that read the
  // output is not sent it again.
  it("sends the result of a foreground command its caller did not collect", async () => {
    connectHost();
    await waitFor(() => manager.status(HOST_ID).online);
    const exec = createExec({ resultPickupMs: 50 });
    const collectedJob = await finished(exec, (await run(exec, "echo seen")).id);
    await exec.readOutput(collectedJob.id, { readerSessionId: "session-a" });
    const abandoned = await finished(exec, (await run(exec, "echo unseen")).id);
    // Someone else reading it does not count as the caller collecting it.
    await exec.readOutput(abandoned.id, { readerSessionId: "leader" });
    await waitFor(() => notices.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(notices.map((notice) => notice.text.split("\n")[0])).toEqual([
      expect.stringContaining(`${HOST_EXEC_MESSAGE_TAG} ${abandoned.id} on condor: exit 0`),
    ]);
    expect(exec.get(abandoned.id)?.background).toBe(true);
    expect(exec.get(collectedJob.id)?.background).toBe(false);
  });

  // Killing a command stops everything it started, not just its shell.
  it("kills the command and the processes it started", async () => {
    connectHost();
    await waitFor(() => manager.status(HOST_ID).online);
    const exec = createExec();
    const pidFile = join(dir, "child.pid");
    const started = await run(exec, `sleep 30 & echo $! > ${pidFile}; wait`, { background: true });
    let childPid = 0;
    await waitFor(async () => {
      childPid = Number(await readFile(pidFile, "utf-8").catch(() => "0"));
      return childPid > 0;
    });
    exec.kill(started.id);
    const job = await finished(exec, started.id);
    expect(job).toMatchObject({ status: "exited", signal: "SIGTERM" });
    await waitFor(() => {
      try {
        process.kill(childPid, 0);
        return false;
      } catch {
        return true;
      }
    });
  });

  // The user's off switch, unknown names and an offline host are refused before anything starts.
  it("refuses machines that are turned off, unknown or offline", async () => {
    const offline = createExec();
    await expect(run(offline, "true")).rejects.toMatchObject({ status: 409, message: "Host condor is offline" });
    const disabled = createExec({ execDisabled: () => true });
    await expect(run(disabled, "true")).rejects.toMatchObject({ status: 403 });
    await expect(
      offline.start({
        sessionId: "s",
        sessionNum: null,
        questId: null,
        host: "nope",
        command: "true",
        background: false,
      }),
    ).rejects.toEqual(new HostExecError(404, "No machine named nope; machines: devbox, condor"));
    expect(offline.list()).toEqual([]);
  });

  // A restarted coordinator takes over a running command: it keeps running on
  // the host, its output continues in the same log and its end is recorded.
  it("takes over a running command after a coordinator restart", async () => {
    connectHost();
    await waitFor(() => manager.status(HOST_ID).online);
    const first = createExec();
    const started = await run(first, "echo before; sleep 0.5; echo after", { background: true });
    await waitFor(
      async () => (await first.readOutput(started.id, { readerSessionId: "session-a" }))?.output === "before\n",
    );

    manager = new HostLinkManager();
    const second = createExec();
    await second.restore();
    links.at(-1)!.drop();
    const job = await finished(second, started.id);
    expect(job).toMatchObject({ status: "exited", exitCode: 0 });
    expect((await second.readOutput(job.id, { readerSessionId: "session-a" }))?.output).toBe("before\nafter\n");
    await waitFor(() => notices.length === 1);
    expect(notices.map((notice) => notice.text.split("\n")[0])).toEqual([
      expect.stringContaining(`${HOST_EXEC_MESSAGE_TAG} x-1 on condor: exit 0`),
    ]);
    // New ids continue after the restored ones.
    expect((await run(second, "true")).id).toBe("x-2");
  });
});
