import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jobProcessGroups, stopProcessTree, type ProcessEntry } from "./process-tree.js";

const entry = (pid: number, ppid: number, pgid: number, sid: number): ProcessEntry => ({ pid, ppid, pgid, sid });

/**
 * A helper process that leaves its parent's process group the way real tools
 * do: `group` moves to a group of its own (GNU `timeout`), `session` starts a
 * new session (`setsid`, daemons). A `stubborn-` mode also ignores SIGTERM.
 * It writes its pid once it has moved.
 */
const LEAVE_SCRIPT = [
  "use POSIX ();",
  "my ($mode, $file) = @ARGV;",
  '$SIG{TERM} = "IGNORE" if $mode =~ /stubborn/;',
  "if ($mode =~ /group/) { setpgrp(0, 0) } else { POSIX::setsid() }",
  'open(my $fh, ">", $file) or die; print $fh $$; close $fh;',
  "sleep 60;",
].join("\n");

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 8_000): Promise<void> {
  const started = Date.now();
  while (!(await condition())) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("jobProcessGroups", () => {
  // The shape of the reported leak: the exec shell (100) runs a pipeline in
  // its own group, GNU timeout (102) moved to a group of its own, a process
  // init adopted after its parent died (104) is still in the job's session,
  // and a descendant started a new session (105). Processes outside the job,
  // including the node that started it (50), are never signalled.
  it("finds every group the job's processes are in, and no others", () => {
    const processes = [
      entry(50, 1, 50, 50),
      entry(100, 50, 100, 100),
      entry(101, 100, 100, 100),
      entry(102, 100, 102, 100),
      entry(103, 102, 102, 100),
      entry(104, 1, 104, 100),
      entry(105, 103, 105, 105),
      entry(106, 105, 105, 105),
      entry(200, 1, 200, 200),
      entry(201, 200, 201, 200),
    ];
    expect(jobProcessGroups(100, processes).sort((a, b) => a - b)).toEqual([100, 102, 104, 105]);
  });

  // macOS `ps` shows no session ids (all 0), so only the tree counts there.
  it("relies on the process tree where sessions are not shown", () => {
    const processes = [entry(100, 50, 100, 0), entry(102, 100, 102, 0), entry(104, 1, 104, 0)];
    expect(jobProcessGroups(100, processes).sort((a, b) => a - b)).toEqual([100, 102]);
  });
});

describe("stopProcessTree", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "process-tree-"));
    await writeFile(join(dir, "leave.pl"), LEAVE_SCRIPT);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // A real job: a detached shell whose children left its group or session,
  // one of them ignoring SIGTERM. SIGTERM ends the shell and the children that
  // honour it; after the grace period SIGKILL ends the stubborn one too, even
  // though the shell that started it is long gone.
  it("stops children that left the group, then SIGKILLs survivors after the grace period", async () => {
    const pidFile = (name: string) => join(dir, `${name}.pid`);
    const script = ["group", "session", "stubborn-group"]
      .map((mode) => `perl ${join(dir, "leave.pl")} ${mode} ${pidFile(mode)} &`)
      .join("\n");
    const root = spawn("/bin/sh", ["-c", `${script}\nwait`], { detached: true, stdio: "ignore" });
    const pids: Record<string, number> = {};
    await waitFor(async () => {
      for (const mode of ["group", "session", "stubborn-group"]) {
        pids[mode] = Number(await readFile(pidFile(mode), "utf-8").catch(() => "0"));
      }
      return Object.values(pids).every((pid) => pid > 0);
    });
    try {
      await stopProcessTree(root.pid!, "SIGTERM", { graceMs: 500 });
      await waitFor(() => !alive(root.pid!) && !alive(pids.group!) && !alive(pids.session!));
      expect(alive(pids["stubborn-group"]!)).toBe(true);
      await waitFor(() => !alive(pids["stubborn-group"]!));
    } finally {
      for (const pid of [root.pid!, ...Object.values(pids)]) if (alive(pid)) process.kill(pid, "SIGKILL");
    }
  });
});
