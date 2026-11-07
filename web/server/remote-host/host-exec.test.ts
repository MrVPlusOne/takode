import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { Readable } from "node:stream";
import { text } from "node:stream/consumers";
import { join } from "node:path";
import { HostAgent, type HostAgentOptions } from "./host-agent.js";
import { HostExec, HostExecError, type HostExecDeps } from "./host-exec.js";
import { HostLinkManager } from "./host-link-manager.js";
import { FakeHostLink } from "../test-fixtures/fake-host-link.js";
import { describeExecOutcome, HOST_EXEC_MESSAGE_TAG } from "../../shared/host-exec.js";

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
 * commands in the test user's own login shell over an in-memory host link,
 * and HostExec records them in a temporary folder. HOME points at a
 * temporary folder whose login profiles are noisy, the way cluster profiles
 * are, and set a variable the command can see.
 */
describe("HostExec", () => {
  let manager: HostLinkManager;
  let agent: HostAgent | null;
  let links: FakeHostLink[];
  let dir: string;
  let notices: Array<{ sessionId: string; text: string }>;
  let changed: string[];
  let home: string;
  const saved = { SHELL: process.env.SHELL, HOME: process.env.HOME };

  beforeEach(async () => {
    manager = new HostLinkManager();
    links = [];
    notices = [];
    changed = [];
    dir = await mkdtemp(join(tmpdir(), "host-exec-"));
    home = await mkdtemp(join(tmpdir(), "host-exec-home-"));
    const profile = 'echo "profile banner"; echo "profile warning" >&2; export PROFILE_VAR=from-profile\n';
    for (const name of [".profile", ".bash_profile", ".zprofile"]) await writeFile(join(home, name), profile);
    process.env.HOME = home;
    // A node started by a scheduler may have no SHELL at all; the passwd entry decides.
    delete process.env.SHELL;
  });

  afterEach(async () => {
    agent?.stop();
    agent = null;
    process.env.HOME = saved.HOME;
    process.env.SHELL = saved.SHELL;
    await rm(dir, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  });

  function connectHost(extra: Partial<HostAgentOptions> = {}): void {
    agent = new HostAgent({
      ...extra,
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

  const run = (exec: HostExec, command: string, extra: { cwd?: string; memoryLimitBytes?: number } = {}) =>
    exec.start({
      sessionId: "session-a",
      sessionNum: 7,
      questId: "q-1",
      host: "condor",
      command,
      ...(extra.cwd ? { cwd: extra.cwd } : {}),
      ...(extra.memoryLimitBytes ? { memoryLimitBytes: extra.memoryLimitBytes } : {}),
    });

  async function finished(exec: HostExec, id: string) {
    await waitFor(async () => (await exec.wait(id, 500))?.status !== "running");
    return exec.get(id)!;
  }

  // The basic contract: output (stdout and stderr together) and the exit code
  // come back, the call is recorded with its session and quest, and its
  // caller gets the result itself: the session is sent no message.
  it("runs a foreground command and records its outcome and output", async () => {
    connectHost();
    await waitFor(() => manager.status(HOST_ID).online);
    const exec = createExec();
    const started = await run(exec, "echo out; echo err >&2; exit 3");
    expect(started).toMatchObject({ id: "x-1", host: "condor", status: "running", sessionNum: 7, questId: "q-1" });
    const job = await finished(exec, started.id);
    expect(job).toMatchObject({ status: "exited", exitCode: 3, signal: null });
    expect(job.endedAt).not.toBeNull();
    const output = await exec.readOutput(job.id);
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
    expect((await exec.readOutput(inHome.id))?.output.trim()).toBe(home);
    const tilde = await finished(exec, (await run(exec, "pwd", { cwd: "~" })).id);
    expect(tilde.cwd).toBe("~");
    expect((await exec.readOutput(tilde.id))?.output.trim()).toBe(home);
    const given = await finished(exec, (await run(exec, "pwd", { cwd: dir })).id);
    expect((await exec.readOutput(given.id))?.output.trim()).toBe(dir);
    const missing = await finished(exec, (await run(exec, "pwd", { cwd: join(dir, "missing") })).id);
    expect(missing).toMatchObject({ status: "exited", exitCode: 1 });
    expect((await exec.readOutput(missing.id))?.output).toContain("missing");
  });

  // Commands run as a login shell of the user's own shell from their passwd
  // entry, even without SHELL, so their profile applies; what the profile
  // itself prints never reaches the command's output.
  it("runs in the user's own login shell without the profile's output", async () => {
    connectHost();
    await waitFor(() => manager.status(HOST_ID).online);
    const exec = createExec();
    const job = await finished(exec, (await run(exec, 'echo "$SHELL $PROFILE_VAR"; echo err >&2')).id);
    const output = (await exec.readOutput(job.id))?.output;
    expect(output?.split("\n").sort()).toEqual(["", `${userInfo().shell} from-profile`, "err"]);
  });

  // Long output shows both ends and names the lines left out, and the log
  // gives all of it or any range of lines or bytes.
  it("shows both ends of long output and gives all of it or a range", async () => {
    connectHost();
    await waitFor(() => manager.status(HOST_ID).online);
    const exec = createExec();
    const job = await finished(exec, (await run(exec, "seq 1 20000")).id);
    const all = Array.from({ length: 20000 }, (_, index) => `${index + 1}\n`).join("");
    const shown = (await exec.readOutput(job.id))!;
    expect(shown.truncated).toBe(true);
    const marker = shown.output.match(
      /\[\.\.\. lines (\d+)-(\d+) not shown; just those: `takode exec logs x-1 --lines \1-\2`/,
    );
    expect(marker).not.toBeNull();
    const [from, to] = [Number(marker![1]), Number(marker![2])];
    // The excerpt's lines and the hidden range together are exactly the output.
    const visible = shown.output.split("\n").filter((line) => /^\d+$/.test(line));
    expect(visible).toEqual([
      ...Array.from({ length: from - 1 }, (_, index) => `${index + 1}`),
      ...Array.from({ length: 20000 - to }, (_, index) => `${to + index + 1}`),
    ]);
    const read = async (options: Parameters<HostExec["readLog"]>[1]) =>
      text((await exec.readLog(job.id, options)) as Readable);
    expect(await read({})).toBe(all);
    expect(await read({ lines: [from, to] })).toBe(
      all
        .split("\n")
        .slice(from - 1, to)
        .join("\n") + "\n",
    );
    expect(await read({ bytes: [1, 6] })).toBe("1\n2\n3\n");
  });

  // A running command is the session's work in progress, which its waits and
  // the board's stall check show, but its end sends no message: its caller
  // (often the agent's own background shell) gets the result, so the command
  // is not something that starts the session's next turn.
  it("counts a running command as work in progress that sends no message", async () => {
    connectHost();
    await waitFor(() => manager.status(HOST_ID).online);
    const exec = createExec();
    const started = await run(exec, "sleep 0.3");
    expect(exec.backgroundTasks("session-a")?.tasks).toEqual([
      expect.objectContaining({ taskId: started.id, description: expect.stringContaining("takode exec on condor") }),
    ]);
    expect(exec.backgroundTasks("session-a", { notifyingOnly: true })).toBeNull();
    await finished(exec, started.id);
    expect(exec.backgroundTasks("session-a")?.tasks).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(notices).toEqual([]);
  });

  // A command dies with its caller, like a local one. A caller killed outright
  // (SIGKILL, a crashed agent) cannot stop it, so a command nobody asks about
  // for the caller-gone window is stopped and its outcome says why; one whose
  // caller keeps waiting runs on.
  it("stops a command whose caller stopped asking about it", async () => {
    connectHost();
    await waitFor(() => manager.status(HOST_ID).online);
    const exec = createExec({ callerGoneMs: 300, callerCheckMs: 50 });
    const abandoned = await run(exec, "sleep 30");
    const waitedFor = await run(exec, "sleep 1.5; echo done");
    let waited = exec.get(waitedFor.id)!;
    // The caller's long polls, each shorter than the window, keep it alive.
    while (waited.status === "running") waited = (await exec.wait(waitedFor.id, 200))!;
    expect(waited).toMatchObject({ status: "exited", exitCode: 0 });
    expect(waited.callerGone).toBeUndefined();
    // Polled without waiting: a wait would count as its caller asking.
    await waitFor(() => exec.get(abandoned.id)?.status !== "running");
    const stopped = exec.get(abandoned.id)!;
    expect(stopped.callerGone).toBe(true);
    expect(describeExecOutcome(stopped)).toBe("stopped: its caller went away");
    expect(notices).toEqual([]);
  });

  // Killing a command stops everything it started, not just its shell.
  // A server shutdown waits for requests it accepted, and a foreground caller's wait could hold it
  // 30 s. Released waits answer at once with the command still running; it carries on for the next server.
  it("answers waiting callers at once when the server shuts down, leaving the command running", async () => {
    connectHost();
    await waitFor(() => manager.status(HOST_ID).online);
    const exec = createExec();
    const started = await run(exec, "sleep 30");
    const waiting = exec.wait(started.id, 30_000);
    const before = performance.now();
    exec.releaseWaits();
    expect((await waiting)?.status).toBe("running");
    expect(performance.now() - before).toBeLessThan(1_000);
    exec.kill(started.id);
    await finished(exec, started.id);
  });

  // The reported leak: `timeout ... run.sh | tee` moved out of the shell's
  // process group, so killing the group ended only the shell. Here one pipeline
  // stage moves to a group of its own the way GNU timeout does, and another
  // child starts a session of its own the way setsid does.
  it("kills the command and the processes it started", async () => {
    connectHost();
    await waitFor(() => manager.status(HOST_ID).online);
    const exec = createExec();
    const leave = join(dir, "leave.pl");
    await writeFile(
      leave,
      'use POSIX (); my ($mode, $file) = @ARGV; if ($mode eq "group") { setpgrp(0, 0) } else { POSIX::setsid() }\n' +
        'open(my $fh, ">", $file) or die; print $fh $$; close $fh; sleep 60;\n',
    );
    const pidFile = (name: string) => join(dir, `${name}.pid`);
    const started = await run(
      exec,
      `sleep 30 & echo $! > ${pidFile("plain")}; perl ${leave} group ${pidFile("group")} | cat & ` +
        `perl ${leave} session ${pidFile("session")} & wait`,
    );
    let childPids: number[] = [];
    await waitFor(async () => {
      childPids = await Promise.all(
        ["plain", "group", "session"].map(async (name) =>
          Number(await readFile(pidFile(name), "utf-8").catch(() => "0")),
        ),
      );
      return childPids.every((pid) => pid > 0);
    });
    exec.kill(started.id);
    const job = await finished(exec, started.id);
    expect(job).toMatchObject({ status: "exited", signal: "SIGTERM" });
    await waitFor(() =>
      childPids.every((pid) => {
        try {
          process.kill(pid, 0);
          return false;
        } catch {
          return true;
        }
      }),
    );
  });

  // `--memory-limit` end to end: the command's workers pass its limit, the
  // node kills them all, and the outcome its session reads says why. The
  // machine-wide check reads nothing, so only the command's limit can act.
  it("kills a command over its memory limit and says so in its outcome", async () => {
    const MB = 2 ** 20;
    connectHost({ guardMemory: { readMemory: async () => null } });
    await waitFor(() => manager.status(HOST_ID).online);
    const exec = createExec();
    manager.onMemoryKill = (_host, procId, kill) => void exec.memoryKilled(procId, kill);
    const worker = `${JSON.stringify(process.execPath)} -e 'const b = Buffer.alloc(80e6, 1); setInterval(() => b[0]++, 1000)'`;
    const started = await run(exec, `${worker} & ${worker} & wait`, { memoryLimitBytes: 100 * MB });
    expect(started.memoryLimitBytes).toBe(100 * MB);
    const job = await finished(exec, started.id);
    expect(job).toMatchObject({ signal: "SIGKILL", memoryKill: { reason: "command_limit" } });
    expect(job.memoryKill!.bytes).toBeGreaterThan(100 * MB);
    expect(describeExecOutcome(job)).toMatch(/^killed for using \d+ MB, over its 100 MB memory limit \(.+\)$/);
  });

  // A node too old to enforce a limit (or without its memory guard) would run the command uncapped; it is refused.
  it("refuses a memory limit on a node that cannot enforce it", async () => {
    connectHost();
    await waitFor(() => manager.status(HOST_ID).online);
    const exec = createExec();
    await expect(run(exec, "true", { memoryLimitBytes: 2 ** 30 })).rejects.toMatchObject({ status: 409 });
    expect(exec.list()).toEqual([]);
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
    const started = await run(first, "echo before; sleep 0.5; echo after");
    await waitFor(async () => (await first.readOutput(started.id))?.output === "before\n");

    manager = new HostLinkManager();
    const second = createExec();
    await second.restore();
    links.at(-1)!.drop();
    const job = await finished(second, started.id);
    expect(job).toMatchObject({ status: "exited", exitCode: 0 });
    expect((await second.readOutput(job.id))?.output).toBe("before\nafter\n");
    expect(notices).toEqual([]);
    // New ids continue after the restored ones.
    expect((await run(second, "true")).id).toBe("x-2");
  });

  // A command started with the retired --background flag has no caller: the
  // coordinator that takes it over lets it run to the end, however long, and
  // tells its session the outcome, as that flag promised.
  it("finishes a command started with the retired --background flag and tells its session", async () => {
    connectHost();
    await waitFor(() => manager.status(HOST_ID).online);
    const first = createExec();
    const started = await run(first, "echo legacy; sleep 0.6");
    // What an earlier coordinator saved for a background command.
    const path = join(dir, "jobs.json");
    const stored = JSON.parse(await readFile(path, "utf-8"));
    stored.jobs[0].background = true;
    await writeFile(path, JSON.stringify(stored));

    manager = new HostLinkManager();
    const second = createExec({ callerGoneMs: 100, callerCheckMs: 20 });
    await second.restore();
    links.at(-1)!.drop();
    expect(second.backgroundTasks("session-a", { notifyingOnly: true })?.tasks).toHaveLength(1);
    // Nobody asks about it, yet it is not stopped as abandoned.
    await waitFor(() => second.get(started.id)?.status !== "running");
    const job = second.get(started.id)!;
    expect(job).toMatchObject({ status: "exited", exitCode: 0 });
    expect(job).not.toHaveProperty("background");
    await waitFor(() => notices.length === 1);
    expect(notices[0]!.text).toContain(`${HOST_EXEC_MESSAGE_TAG} x-1 on condor: exit 0`);
    expect(notices[0]!.text).toContain("legacy");
  });
});
