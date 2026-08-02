import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const SUPERVISOR = join(REPO_ROOT, "scripts", "relay-tunnel-supervisor.sh");
const PLIST_TEMPLATE = join(REPO_ROOT, "scripts", "com.takode.relay-tunnel.plist.template");
const CONFIG_EXAMPLE = join(REPO_ROOT, "scripts", "relay-tunnel-supervisor.conf.example");
const tempDirs: string[] = [];
const runningProcesses = new Set<ChildProcess>();

interface Fixture {
  root: string;
  state: string;
  fakeState: string;
  config: string;
  identity: string;
  fakeChild: string;
  log: string;
}

interface StatusSnapshot {
  schemaVersion: number;
  state: string;
  ownerToken: string;
  supervisorPid: number;
  childPid: number | null;
  childPgid: number | null;
  attempt: number;
  exitClass: string;
  uptimeSeconds: number;
  backoffSeconds: number;
  healthCode: number | null;
  healthDurationMs: number | null;
  configFingerprint: string;
}

afterEach(async () => {
  for (const child of runningProcesses) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  }
  await Promise.all([...runningProcesses].map((child) => waitForExit(child).catch(() => undefined)));
  runningProcesses.clear();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe("relay tunnel supervisor tracked artifacts", () => {
  it("keeps production values runtime-only and renders a valid user LaunchAgent template", async () => {
    const [source, plist, example] = await Promise.all([
      readFile(SUPERVISOR, "utf8"),
      readFile(PLIST_TEMPLATE, "utf8"),
      readFile(CONFIG_EXAMPLE, "utf8"),
    ]);

    expect(source).toContain('SSH_BIN="/usr/bin/ssh"');
    expect(source).toContain("BACKOFF_SECONDS=(2 4 8 16 30)");
    expect(source).toContain("STABLE_RESET_SECONDS=120");
    expect(source).toContain("QUICK_START_LIMIT=8");
    expect(source).toContain("COOLDOWN_SECONDS=300");
    expect(source).not.toMatch(/\b(?:3455|3456|20000)\b/);
    expect(source).not.toContain("takode-relay");
    expect(source).not.toMatch(/\b(?:lsof|pgrep)\b/);

    expect(plist).toContain("com.takode.relay-tunnel");
    expect(plist).toContain("__SUPERVISOR_PATH__");
    expect(plist).toContain("__CONFIG_PATH__");
    expect(plist).toContain("__STATE_DIRECTORY__");
    expect(plist).toContain("<key>SuccessfulExit</key>");
    expect(plist).not.toContain("NetworkState");
    expect(example).not.toContain("takode-relay");
    expect(example).not.toMatch(/\b(?:3455|3456|20000)\b/);

    if (process.platform === "darwin") {
      const lint = spawnSync("plutil", ["-lint", PLIST_TEMPLATE], { encoding: "utf8" });
      expect(lint.status, lint.stderr).toBe(0);
    }
  });

  it("pauses cleanly on fatal configuration without starting a child or looping", async () => {
    const fixture = await createFixture();
    await chmod(fixture.config, 0o644);

    const child = startSupervisor(fixture, { maxChildExits: 1 });
    const result = await waitForExit(child);
    const status = await readStatus(fixture);

    expect(result.code).toBe(0);
    expect(status.state).toBe("paused_fatal");
    expect(status.exitClass).toBe("config_permissions");
    expect(await pathExists(join(fixture.fakeState, "child-attempts"))).toBe(false);
    expect(await pathExists(join(fixture.state, "owner.lock"))).toBe(false);
    expect((await stat(join(fixture.state, "status.json"))).mode & 0o777).toBe(0o600);
  });

  it("quarantines a dead owner, rejects a live duplicate, and removes only its own token", async () => {
    const fixture = await createFixture("hold");
    const staleLock = join(fixture.state, "owner.lock");
    await mkdir(staleLock, { recursive: true, mode: 0o700 });
    await writeFile(join(staleLock, "pid"), "999999\n", { mode: 0o600 });
    await writeFile(join(staleLock, "token"), "dead-owner\n", { mode: 0o600 });

    const owner = startSupervisor(fixture);
    const running = await waitForStatus(fixture, (status) => status.state === "running");
    const originalToken = running.ownerToken;
    const duplicate = startSupervisor(fixture);
    const duplicateResult = await waitForExit(duplicate);

    expect(duplicateResult.code).toBe(0);
    expect(processIsAlive(owner.pid!)).toBe(true);
    expect((await readStatus(fixture)).ownerToken).toBe(originalToken);
    const quarantines = (await readdir(fixture.state)).filter((name) => name.startsWith("owner.lock.quarantine."));
    expect(quarantines).toHaveLength(1);
    expect((await stat(join(fixture.state, quarantines[0]))).mode & 0o777).toBe(0o700);
    expect((await stat(join(fixture.state, quarantines[0], "pid"))).mode & 0o777).toBe(0o600);
    expect(await readFile(fixture.log, "utf8")).toContain("event=live_owner_rejected");

    owner.kill("SIGTERM");
    expect((await waitForExit(owner)).code).toBe(0);
    expect(await pathExists(join(fixture.state, "owner.lock"))).toBe(false);
    expect((await readStatus(fixture)).state).toBe("stopped");
  });

  it("fails closed on a live unknown lock owner without signalling it", async () => {
    const fixture = await createFixture();
    const unrelated = spawn("sleep", ["30"], { stdio: "ignore" });
    runningProcesses.add(unrelated);
    await waitFor(() => processIsAlive(unrelated.pid!));
    const lock = join(fixture.state, "owner.lock");
    await mkdir(lock, { recursive: true, mode: 0o700 });
    await writeFile(join(lock, "pid"), `${unrelated.pid}\n`, { mode: 0o600 });
    await writeFile(join(lock, "token"), "unrelated-live-owner\n", { mode: 0o600 });

    const contender = startSupervisor(fixture);
    expect((await waitForExit(contender)).code).toBe(0);
    expect(processIsAlive(unrelated.pid!)).toBe(true);
    expect(await readFile(join(lock, "token"), "utf8")).toBe("unrelated-live-owner\n");
  });

  it("records a verified child process-group handshake before exact deliberate cleanup", async () => {
    for (let iteration = 0; iteration < 5; iteration += 1) {
      const fixture = await createFixture("hold-with-child");
      const supervisor = startSupervisor(fixture);
      const status = await waitForStatus(fixture, (snapshot) => snapshot.state === "running");
      expect(status.childPid).toBeTypeOf("number");
      expect(status.childPgid).toBe(status.childPid);
      expect(readProcessGroup(status.childPid!)).toBe(status.childPgid);
      const nestedPid = Number(await waitForFile(join(fixture.fakeState, "nested-pid")));

      supervisor.kill("SIGTERM");
      expect((await waitForExit(supervisor)).code).toBe(0);
      expect(processIsAlive(status.childPid!)).toBe(false);
      expect(processIsAlive(nestedPid)).toBe(false);
      expect((await readStatus(fixture)).exitClass).toBe("deliberate_stop");
    }
  }, 15_000);

  it("exits nonzero and leaves no child or lock when the PGID handshake fails", async () => {
    const fixture = await createFixture("hold");
    const supervisor = startSupervisor(fixture, { handshakeFail: true, handshakeTicks: 3 });
    const result = await waitForExit(supervisor);
    const status = await readStatus(fixture);

    expect(result.code).toBe(70);
    expect(status.state).toBe("crashed");
    expect(status.exitClass).toBe("wrapper_error");
    expect(await pathExists(join(fixture.state, "owner.lock"))).toBe(false);
    expect(findFixtureProcesses(fixture.root)).toEqual([]);
  });

  it.each([
    ["exit:0", "exit_0"],
    ["exit:255", "exit_255"],
    ["signal:15", "signal_15"],
  ])("classifies unexpected child behavior %s as %s", async (mode, expectedClass) => {
    const fixture = await createFixture(mode);
    const supervisor = startSupervisor(fixture, { maxChildExits: 1 });
    expect((await waitForExit(supervisor)).code).toBe(0);
    const status = await readStatus(fixture);
    expect(status.state).toBe("paused_test_complete");
    expect(status.exitClass).toBe(expectedClass);
  });

  it("uses bounded backoff and resets the attempt after a stable child", async () => {
    const fixture = await createFixture();
    await writeFile(join(fixture.fakeState, "sequence"), "exit:255\nexit:255\nexit:255\n", "utf8");
    const fast = startSupervisor(fixture, {
      backoffs: "0.01,0.02,0.03,0.04,0.05",
      maxChildExits: 3,
    });
    expect((await waitForExit(fast)).code).toBe(0);
    const firstLog = await readFile(fixture.log, "utf8");
    expect(firstLog).toContain("backoff_seconds=0.01");
    expect(firstLog).toContain("backoff_seconds=0.02");
    expect(firstLog).toContain("backoff_seconds=0.03");

    const stableFixture = await createFixture();
    await writeFile(join(stableFixture.fakeState, "sequence"), "sleep:1.1:255\nexit:255\n", "utf8");
    const stable = startSupervisor(stableFixture, {
      backoffs: "0.01,0.02,0.03,0.04,0.05",
      maxChildExits: 2,
      stableSeconds: 1,
    });
    const stableResult = await waitForExit(stable);
    const stableDebug = {
      result: stableResult,
      status: await readStatus(stableFixture),
      log: await readFile(stableFixture.log, "utf8"),
    };
    expect(stableResult.code, JSON.stringify(stableDebug, null, 2)).toBe(0);
    const stableLog = await readFile(stableFixture.log, "utf8");
    expect(stableLog).toContain("event=stable_child_reset");
    expect((await readStatus(stableFixture)).attempt).toBe(1);
  }, 10_000);

  it("persists wrapper start history so a launchd restart cannot reset cooldown", async () => {
    const fixture = await createFixture("exit:255");
    const sharedOptions = {
      backoffs: "0.01,0.01,0.01,0.01,0.01",
      maxChildExits: 1,
      quickStartLimit: 2,
      cooldownSeconds: 1,
    };
    const first = startSupervisor(fixture, sharedOptions);
    expect((await waitForExit(first)).code).toBe(0);

    const startedAt = Date.now();
    const second = startSupervisor(fixture, sharedOptions);
    expect((await waitForExit(second)).code).toBe(0);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(900);
    expect(await readFile(fixture.log, "utf8")).toContain("event=restart_storm_cooldown");
  });

  it("rate-limits a quick child restart storm before allowing retries to resume", async () => {
    const fixture = await createFixture("exit:255");
    const startedAt = Date.now();
    const supervisor = startSupervisor(fixture, {
      backoffs: "0.01,0.01,0.01,0.01,0.01",
      maxChildExits: 3,
      quickStartLimit: 3,
      cooldownSeconds: 1,
    });

    expect((await waitForExit(supervisor)).code).toBe(0);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(900);
    expect(await readFile(fixture.log, "utf8")).toContain("event=restart_storm_cooldown");
  });

  it("keeps status and logs atomic, bounded to metadata keys, and child environment sparse", async () => {
    const fixture = await createFixture("exit:255");
    const supervisor = startSupervisor(fixture, {
      backoffs: "0.01,0.01,0.01,0.01,0.01",
      maxChildExits: 5,
    });
    const parsedSnapshots: StatusSnapshot[] = [];
    while (supervisor.exitCode === null && supervisor.signalCode === null) {
      try {
        parsedSnapshots.push(JSON.parse(await readFile(join(fixture.state, "status.json"), "utf8")));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await delay(2);
    }
    await waitForExit(supervisor);
    const statusText = await readFile(join(fixture.state, "status.json"), "utf8");
    const logText = await readFile(fixture.log, "utf8");
    const combined = `${statusText}\n${logText}`;
    expect(parsedSnapshots.length).toBeGreaterThan(0);
    for (const snapshot of parsedSnapshots) {
      expect(snapshot.schemaVersion).toBe(1);
      expect(snapshot).toHaveProperty("healthCode");
      expect(snapshot).toHaveProperty("healthDurationMs");
      expect(snapshot).toHaveProperty("configFingerprint");
      expect(snapshot.healthCode === null || snapshot.healthCode === 200).toBe(true);
      expect(snapshot.healthDurationMs === null || snapshot.healthDurationMs === 123).toBe(true);
      expect(snapshot.configFingerprint).toMatch(/^[a-f0-9]{64}$/);
    }

    const allowedLogKeys = new Set([
      "component",
      "schema",
      "event",
      "state",
      "attempt",
      "exit_class",
      "backoff_seconds",
      "health_code",
      "health_duration_ms",
      "owner_token",
      "supervisor_pid",
      "child_pid",
      "child_pgid",
      "config_fingerprint",
    ]);
    for (const line of logText.trim().split("\n")) {
      for (const field of line.split(" ")) expect(allowedLogKeys).toContain(field.split("=", 1)[0]);
    }
    for (const forbidden of [
      "private-relay.example",
      "do-not-log-identity",
      "do-not-log-ssh-config",
      "do-not-log-health.example",
      "15432",
      "15433",
      "-R",
      "SSH_IDENTITY_FILE",
      "prompt",
      "credential",
      "payload",
    ]) {
      expect(combined).not.toContain(forbidden);
    }

    const envText = await readFile(join(fixture.fakeState, "env.1"), "utf8");
    expect(envText).not.toContain("SSH_AUTH_SOCK=");
    expect(envText).not.toContain("TAKODE_RELAY_SUPERVISOR_TEST_CHILD=");
    const argsText = await readFile(join(fixture.fakeState, "args.1"), "utf8");
    for (const option of [
      "BatchMode=yes",
      "ConnectTimeout=10",
      "ServerAliveInterval=10",
      "ServerAliveCountMax=3",
      "ExitOnForwardFailure=yes",
      "TCPKeepAlive=no",
      "ControlMaster=no",
      "IdentityAgent=none",
      "StrictHostKeyChecking=yes",
    ]) {
      expect(argsText).toContain(option);
    }
    expect((await stat(join(fixture.state, "status.json"))).mode & 0o777).toBe(0o600);
    expect((await stat(fixture.state)).mode & 0o777).toBe(0o700);
    const finalStatus: StatusSnapshot = JSON.parse(statusText);
    expect(finalStatus.healthCode).toBe(200);
    expect(finalStatus.healthDurationMs).toBe(123);
  });
});

async function createFixture(mode = "exit:255"): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "takode-relay-supervisor-"));
  tempDirs.push(root);
  const state = join(root, "state with spaces");
  const fakeState = join(root, "fake-child-state");
  const config = join(root, "runtime.conf");
  const sshConfig = join(root, "do-not-log-ssh-config");
  const identity = join(root, "do-not-log-identity");
  const fakeChild = join(root, "fake-ssh-child.sh");
  const log = join(root, "metadata-events.log");
  await mkdir(state, { recursive: true, mode: 0o700 });
  await mkdir(fakeState, { recursive: true, mode: 0o700 });
  await writeFile(join(fakeState, "mode"), `${mode}\n`, "utf8");
  await writeFile(sshConfig, "Host private-relay.example\n  HostName 192.0.2.1\n", { mode: 0o600 });
  await writeFile(identity, "disposable-test-identity\n", { mode: 0o600 });
  await writeFile(
    config,
    [
      "SSH_HOST=private-relay.example",
      `SSH_CONFIG_FILE=${sshConfig}`,
      `SSH_IDENTITY_FILE=${identity}`,
      "REMOTE_BIND_HOST=127.0.0.1",
      "REMOTE_PORT=15432",
      "LOCAL_HOST=127.0.0.1",
      "LOCAL_PORT=15433",
      "HEALTHCHECK_URL=https://do-not-log-health.example/api/health",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  await writeFile(fakeChild, fakeChildSource(), { mode: 0o755 });
  return { root, state, fakeState, config, identity, fakeChild, log };
}

function startSupervisor(
  fixture: Fixture,
  options: {
    backoffs?: string;
    maxChildExits?: number;
    stableSeconds?: number;
    quickStartLimit?: number;
    cooldownSeconds?: number;
    handshakeFail?: boolean;
    handshakeTicks?: number;
  } = {},
): ChildProcess {
  const child = spawn("/bin/bash", [SUPERVISOR, fixture.config, fixture.state], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      TAKODE_RELAY_SUPERVISOR_TESTING: "1",
      TAKODE_RELAY_SUPERVISOR_TEST_CHILD: fixture.fakeChild,
      TAKODE_RELAY_SUPERVISOR_TEST_STATE: fixture.fakeState,
      TAKODE_RELAY_SUPERVISOR_TEST_LOG_FILE: fixture.log,
      TAKODE_RELAY_SUPERVISOR_TEST_BACKOFFS: options.backoffs ?? "0.01,0.02,0.03,0.04,0.05",
      TAKODE_RELAY_SUPERVISOR_TEST_MAX_CHILD_EXITS: String(options.maxChildExits ?? 0),
      TAKODE_RELAY_SUPERVISOR_TEST_STABLE_SECONDS: String(options.stableSeconds ?? 120),
      TAKODE_RELAY_SUPERVISOR_TEST_WINDOW_SECONDS: "60",
      TAKODE_RELAY_SUPERVISOR_TEST_START_LIMIT: String(options.quickStartLimit ?? 8),
      TAKODE_RELAY_SUPERVISOR_TEST_COOLDOWN_SECONDS: String(options.cooldownSeconds ?? 1),
      TAKODE_RELAY_SUPERVISOR_TEST_HANDSHAKE_FAIL: options.handshakeFail ? "1" : "0",
      TAKODE_RELAY_SUPERVISOR_TEST_HANDSHAKE_TICKS: String(options.handshakeTicks ?? 200),
      TAKODE_RELAY_SUPERVISOR_TEST_HEALTH_RESULT: "200 0.123",
      TAKODE_RELAY_SUPERVISOR_TEST_TERM_TICKS: "20",
      TAKODE_RELAY_SUPERVISOR_TEST_TERM_TICK_SECONDS: "0.01",
    },
  });
  runningProcesses.add(child);
  void child.once("exit", () => runningProcesses.delete(child));
  return child;
}

async function waitForExit(
  child: ChildProcess,
  timeoutMs = 5_000,
): Promise<{ code: number | null; signal: string | null }> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode };
  }
  return await Promise.race([
    new Promise<{ code: number | null; signal: string | null }>((resolveExit, rejectExit) => {
      child.once("exit", (code, signal) => resolveExit({ code, signal }));
      child.once("error", rejectExit);
    }),
    delay(timeoutMs).then(() => {
      throw new Error(`Timed out waiting for process ${child.pid ?? "unknown"}`);
    }),
  ]);
}

async function waitForStatus(
  fixture: Fixture,
  predicate: (status: StatusSnapshot) => boolean,
): Promise<StatusSnapshot> {
  let latest: StatusSnapshot | undefined;
  await waitFor(async () => {
    try {
      latest = JSON.parse(await readFile(join(fixture.state, "status.json"), "utf8"));
      return predicate(latest!);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return false;
      throw error;
    }
  });
  return latest!;
}

async function readStatus(fixture: Fixture): Promise<StatusSnapshot> {
  return JSON.parse(await readFile(join(fixture.state, "status.json"), "utf8"));
}

async function waitForFile(path: string): Promise<string> {
  let value = "";
  await waitFor(async () => {
    try {
      value = (await readFile(path, "utf8")).trim();
      return value.length > 0;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  });
  return value;
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 4_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(10);
  }
  throw new Error("Timed out waiting for condition");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readProcessGroup(pid: number): number {
  const result = spawnSync("ps", ["-o", "pgid=", "-p", String(pid)], { encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
  return Number(result.stdout.trim());
}

function findFixtureProcesses(root: string): number[] {
  const result = spawnSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" });
  return result.stdout
    .split("\n")
    .filter((line) => line.includes(root) && line.includes("fake-ssh-child.sh"))
    .map((line) => Number(line.trim().split(/\s+/, 1)[0]))
    .filter(Number.isFinite);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function fakeChildSource(): string {
  return `#!/bin/bash
set -u
state=\${TAKODE_RELAY_SUPERVISOR_TEST_STATE:?}
counter_file="$state/child-attempts"
counter=$(cat "$counter_file" 2>/dev/null || echo 0)
counter=$((counter + 1))
printf '%s\\n' "$counter" > "$counter_file"
printf '%s\\n' "$@" > "$state/args.$counter"
env | sort > "$state/env.$counter"
mode=$(sed -n "\${counter}p" "$state/sequence" 2>/dev/null || true)
if [ -z "$mode" ]; then mode=$(cat "$state/mode"); fi
case "$mode" in
  hold)
    trap 'exit 0' TERM INT
    sleep 60
    ;;
  hold-with-child)
    sleep 60 &
    nested=$!
    printf '%s\\n' "$nested" > "$state/nested-pid"
    trap 'kill "$nested" 2>/dev/null || true; wait "$nested" 2>/dev/null || true; exit 0' TERM INT
    wait "$nested"
    ;;
  exit:*) exit "\${mode#exit:}" ;;
  signal:*) kill -"\${mode#signal:}" $$ ;;
  sleep:*)
    rest=\${mode#sleep:}
    duration=\${rest%%:*}
    code=\${rest#*:}
    sleep "$duration"
    exit "$code"
    ;;
  *) exit 64 ;;
esac
`;
}
