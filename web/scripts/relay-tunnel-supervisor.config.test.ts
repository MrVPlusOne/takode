import { spawnSync } from "node:child_process";
import {
  appendFile,
  chmod,
  mkdir,
  mkdtemp,
  lstat,
  readFile,
  realpath,
  rename,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  CONFIG_EXAMPLE,
  OPERATIONS_DOC,
  PLIST_TEMPLATE,
  SUPERVISOR,
  type StatusSnapshot,
  createFixture,
  delay,
  expectExactForwardContract,
  expectPausedFatal,
  pathExists,
  readStatus,
  replaceConfigValue,
  startSupervisor,
  tempDirs,
  waitForExit,
  waitForFile,
  waitForStatus,
  writeExecutable,
  registerSupervisorCleanup,
} from "./relay-tunnel-supervisor.test-helpers.js";

vi.setConfig({ testTimeout: 30_000 });
registerSupervisorCleanup();

describe("relay tunnel supervisor tracked artifacts", () => {
  it("keeps production values runtime-only and renders a valid user LaunchAgent template", async () => {
    const [source, plist, example, operations] = await Promise.all([
      readFile(SUPERVISOR, "utf8"),
      readFile(PLIST_TEMPLATE, "utf8"),
      readFile(CONFIG_EXAMPLE, "utf8"),
      readFile(OPERATIONS_DOC, "utf8"),
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
    expect(example).toContain("HEALTHCHECK_URL=http://127.0.0.1:15433/api/health");
    expect(example).not.toContain("HEALTHCHECK_URL=https://");
    expect(operations).toContain("Before every child start");
    expect(operations).toContain("deliberate reload is bootout");
    expect(operations).toContain("state/events.log");
    expect(operations).toContain("unified-log mirror is best-effort");
    const readiness = operations.match(
      /### Thirty-second wall-clock readiness evidence[\s\S]*?```bash\n([\s\S]*?)\n```/,
    )?.[1];
    expect(readiness).toBeDefined();
    expect(spawnSync("/bin/bash", ["-n"], { input: readiness, encoding: "utf8" }).status).toBe(0);
    expect(readiness).toContain("deadline=$(( started_epoch + 30 ))");
    expect(readiness).toContain('launchctl bootstrap "gui/$UID" "$PLIST_PATH"');
    expect(readiness).toContain('-o ClearAllForwardings=yes "$RELAY_HOST"');
    expect(readiness).toContain('"$launchd_pid" = "$status_supervisor_pid"');
    expect(readiness).toContain('"$actual_child_ppid" = "$status_supervisor_pid"');
    expect(readiness).toContain('"$supervisor_count" = 1');
    expect(readiness).toContain('"$child_count" = 1');
    expect(readiness).toContain('"$child_pid" = "$actual_child_pgid"');
    expect(readiness).toContain('"$3" -gt 0');
    expect(readiness).toContain('"$4" = sshd');
    expect(readiness).toContain('"$5" = 1');
    expect(readiness).toContain('"$1" = 1');
    expect(readiness).toContain('"$2" = 0');
    expect(readiness).toContain('"$observed_epoch" -le "$deadline"');
    expect(readiness).toContain("first_ready_epoch=$observed_epoch");
    expect(readiness).toContain('attempt_dir="$EVIDENCE_DIR/readiness-attempt-$attempt_utc-$attempt_token"');
    expect(readiness).toContain('mkdir -m 700 "$attempt_dir"');
    expect(readiness).toContain('trace="$attempt_dir/readiness.tsv"');
    expect(readiness).toContain('first_ready="$attempt_dir/readiness.first-ready.tsv"');

    const evidenceFields = [
      "started_epoch",
      "deadline",
      "observed_epoch",
      "observed_utc",
      "first_ready_epoch",
      "launchd_pid",
      "status_supervisor_pid",
      "actual_child_ppid",
      "child_pid",
      "child_pgid",
      "actual_child_pgid",
      "supervisor_count",
      "child_count",
      "app_listeners",
      "monitor_listeners",
      "app_owner_pid",
      "app_owner_type",
      "app_owner_is_sshd",
      "status_state",
      "local_health",
      "upstream_health",
      "coherent",
    ];
    expect(readiness).toContain(`trace_header=$(printf '${evidenceFields.join("\\t")}')`);
    const pollRow = readiness.match(/poll_row=\$\(printf[\s\S]*?\"\$coherent\"\)/)?.[0];
    expect(pollRow).toBeDefined();
    for (const value of [
      '"$started_epoch"',
      '"$deadline"',
      '"$observed_epoch"',
      '"$observed_utc"',
      '"$first_ready_epoch"',
      '"${launchd_pid:-0}"',
      '"$status_supervisor_pid"',
      '"${actual_child_ppid:-0}"',
      '"$child_pid"',
      '"$child_pgid"',
      '"${actual_child_pgid:-0}"',
      '"$supervisor_count"',
      '"$child_count"',
      '"$1"',
      '"$2"',
      '"$3"',
      '"$4"',
      '"$5"',
      '"$status_state"',
      '"$local_health"',
      '"$6"',
      '"$coherent"',
    ]) {
      expect(pollRow).toContain(value);
    }
    expect(readiness).toContain(`printf '%s\\n%s\\n' "$trace_header" "$poll_row" > "$first_ready_tmp"`);
    expect(readiness).toContain('ln "$first_ready_tmp" "$first_ready"');
    expect(readiness).toContain('[ ! -e "$first_ready" ]');

    if (process.platform === "darwin") {
      const lint = spawnSync("plutil", ["-lint", PLIST_TEMPLATE], { encoding: "utf8" });
      expect(lint.status, lint.stderr).toBe(0);
    }
  });

  it("keeps readiness proof scoped across successive success and failure attempts", async () => {
    const operations = await readFile(OPERATIONS_DOC, "utf8");
    const readiness = operations.match(
      /### Thirty-second wall-clock readiness evidence[\s\S]*?```bash\n([\s\S]*?)\n```/,
    )?.[1];
    expect(readiness).toBeDefined();

    const root = await realpath(await mkdtemp(join(tmpdir(), "relay-readiness-evidence-")));
    tempDirs.push(root);
    const fakeBin = join(root, "bin");
    const evidenceRoot = join(root, "evidence");
    await mkdir(fakeBin, { mode: 0o700 });
    await mkdir(evidenceRoot, { mode: 0o700 });
    await Promise.all([
      writeExecutable(join(fakeBin, "uuidgen"), `#!/bin/bash\nprintf '%s\\n' "$READINESS_ATTEMPT_TOKEN"\n`),
      writeExecutable(
        join(fakeBin, "date"),
        `#!/bin/bash
if [ "$1" = "-u" ]; then
  if [ "$2" = "+%Y%m%dT%H%M%SZ" ]; then
    printf '%s\\n' "$READINESS_ATTEMPT_UTC"
  else
    printf '2026-08-02T01:02:03Z\\n'
  fi
  exit 0
fi
count=0
[ ! -f "$READINESS_DATE_STATE" ] || read -r count < "$READINESS_DATE_STATE"
printf '%s\\n' "$(( count + 1 ))" > "$READINESS_DATE_STATE"
case "$count" in
  0|1) value=$READINESS_EPOCH_BASE ;;
  2) value=$(( READINESS_EPOCH_BASE + 1 )) ;;
  *) value=$(( READINESS_EPOCH_BASE + 31 )) ;;
esac
printf '%s\\n' "$value"
`,
      ),
      writeExecutable(
        join(fakeBin, "launchctl"),
        `#!/bin/bash
case "$1" in
  bootstrap) exit 0 ;;
  print) [ "$READINESS_TEST_MODE" != success ] || printf 'pid = 111\\n' ;;
esac
`,
      ),
      writeExecutable(
        join(fakeBin, "jq"),
        `#!/bin/bash
case "$*" in
  *supervisorPid*) printf '111\\n' ;;
  *childPid*) printf '222\\n' ;;
  *childPgid*) printf '222\\n' ;;
  *state*) printf 'running\\n' ;;
  *healthCode*) printf '200\\n' ;;
  *) exit 1 ;;
esac
`,
      ),
      writeExecutable(
        join(fakeBin, "ps"),
        `#!/bin/bash
case "$*" in
  *ppid=*) printf '111\\n' ;;
  *pgid=*) printf '222\\n' ;;
  *'-axo command='*) printf '/bin/bash %s %s %s\\n' "$SUPERVISOR_PATH" "$CONFIG_PATH" "$STATE_DIR" ;;
  *) exit 1 ;;
esac
`,
      ),
      writeExecutable(join(fakeBin, "pgrep"), `#!/bin/bash\nprintf '222\\n'\n`),
      writeExecutable(join(fakeBin, "ssh"), `#!/bin/bash\nprintf '1 0 333 sshd 1 200\\n'\n`),
      writeExecutable(join(fakeBin, "sleep"), `#!/bin/bash\nexit 0\n`),
    ]);

    const runAttempt = (token: string, mode: "success" | "failure", epochBase: number) =>
      spawnSync("/bin/bash", ["-s"], {
        input: readiness,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${fakeBin}:/usr/bin:/bin`,
          EVIDENCE_DIR: evidenceRoot,
          STATE_FILE: join(root, "status.json"),
          LAUNCHD_LABEL: "com.example.relay-tunnel",
          PLIST_PATH: join(root, "relay.plist"),
          SUPERVISOR_PATH: join(root, "supervisor.sh"),
          CONFIG_PATH: join(root, "runtime.conf"),
          STATE_DIR: join(root, "state"),
          RELAY_HOST: "relay-test",
          RELAY_APPLICATION_PORT: "15432",
          RELAY_MONITOR_PORT: "15433",
          READINESS_ATTEMPT_TOKEN: token,
          READINESS_ATTEMPT_UTC: "20260802T010203Z",
          READINESS_DATE_STATE: join(root, `date-${token}`),
          READINESS_EPOCH_BASE: String(epochBase),
          READINESS_TEST_MODE: mode,
        },
      });
    const attemptPath = (token: string) => join(evidenceRoot, `readiness-attempt-20260802T010203Z-${token}`);
    const firstToken = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const failedToken = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    const secondToken = "cccccccc-cccc-cccc-cccc-cccccccccccc";

    const first = runAttempt(firstToken, "success", 100);
    expect(first.status, first.stderr).toBe(0);
    const firstDir = attemptPath(firstToken);
    const firstReady = join(firstDir, "readiness.first-ready.tsv");
    expect(first.stdout).toContain(`readiness_attempt=${firstDir}`);
    expect(await pathExists(firstReady)).toBe(true);

    const failed = runAttempt(failedToken, "failure", 200);
    expect(failed.status).toBe(1);
    const failedDir = attemptPath(failedToken);
    expect(failed.stdout).toContain(`readiness_attempt=${failedDir}`);
    expect(failed.stdout).not.toContain(firstDir);
    expect(await pathExists(join(failedDir, "readiness.tsv"))).toBe(true);
    expect(await pathExists(join(failedDir, "readiness.first-ready.tsv"))).toBe(false);
    expect(await pathExists(firstReady)).toBe(true);

    const second = runAttempt(secondToken, "success", 300);
    expect(second.status, second.stderr).toBe(0);
    const secondDir = attemptPath(secondToken);
    const secondReady = join(secondDir, "readiness.first-ready.tsv");
    expect(second.stdout).toContain(`readiness_attempt=${secondDir}`);
    expect(await pathExists(secondReady)).toBe(true);
    expect(new Set([firstDir, failedDir, secondDir]).size).toBe(3);

    const firstRows = (await readFile(firstReady, "utf8")).trim().split("\n");
    const secondRows = (await readFile(secondReady, "utf8")).trim().split("\n");
    expect(firstRows).toHaveLength(2);
    expect(secondRows).toHaveLength(2);
    expect(firstRows[0]).toBe(secondRows[0]);
    expect(firstRows[1]?.split("\t")).toEqual([
      "100",
      "130",
      "101",
      "2026-08-02T01:02:03Z",
      "101",
      "111",
      "111",
      "111",
      "222",
      "222",
      "222",
      "1",
      "1",
      "1",
      "0",
      "333",
      "sshd",
      "1",
      "running",
      "200",
      "200",
      "1",
    ]);
    expect(secondRows[1]?.split("\t").slice(0, 5)).toEqual(["300", "330", "301", "2026-08-02T01:02:03Z", "301"]);
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

  it("renders one effective remote forward and no inherited forward types through ssh -G", async () => {
    const fixture = await createFixture("hold");
    const supervisor = startSupervisor(fixture);
    await waitForStatus(fixture, (status) => status.state === "running");

    const renderedArguments = (await waitForFile(join(fixture.fakeState, "args.1"))).split("\n");
    expectExactForwardContract(renderedArguments);

    supervisor.kill("SIGTERM");
    expect((await waitForExit(supervisor)).code).toBe(0);
  });

  it("fails closed when the explicit SSH config contributes an extra forward", async () => {
    const fixture = await createFixture();
    await appendFile(fixture.sshConfig, "  RemoteForward 15434 127.0.0.1:15435\n", "utf8");
    const supervisor = startSupervisor(fixture, { maxChildExits: 1 });

    expect((await waitForExit(supervisor)).code).toBe(0);
    expect((await readStatus(fixture)).exitClass).toBe("ssh_forward_contract");
    expect(await pathExists(join(fixture.fakeState, "child-attempts"))).toBe(false);
  });

  it.each([
    "wrong-owner",
    "wrong-mode",
    "direct-symlink",
    "parent-symlink",
  ])("fails closed on untrusted input path: %s", async (variant) => {
    const fixture = await createFixture();

    if (variant === "wrong-owner") {
      expect(await pathExists("/etc/ssh/ssh_config")).toBe(true);
      await replaceConfigValue(fixture, "SSH_CONFIG_FILE", "/private/etc/ssh/ssh_config");
      await expectPausedFatal(fixture, "ssh_config_owner");
    } else if (variant === "wrong-mode") {
      await chmod(fixture.sshConfig, 0o644);
      await expectPausedFatal(fixture, "ssh_config_permissions");
    } else if (variant === "direct-symlink") {
      const realSshConfig = `${fixture.sshConfig}.real`;
      await rename(fixture.sshConfig, realSshConfig);
      await symlink(realSshConfig, fixture.sshConfig);
      await expectPausedFatal(fixture, "ssh_config_untrusted_path");
    } else {
      const trustedParent = join(fixture.root, "trusted-parent");
      const linkedParent = join(fixture.root, "linked-parent");
      await mkdir(trustedParent, { mode: 0o700 });
      const linkedIdentity = join(trustedParent, "identity");
      await writeFile(linkedIdentity, "disposable\n", { mode: 0o600 });
      await symlink(trustedParent, linkedParent);
      await replaceConfigValue(fixture, "SSH_IDENTITY_FILE", join(linkedParent, "identity"));
      await expectPausedFatal(fixture, "identity_untrusted_path");
    }
  });

  it("never chmods an untrusted existing state path and rejects direct or parent state symlinks", async () => {
    const wrongMode = await createFixture();
    await chmod(wrongMode.state, 0o755);
    const wrongModeResult = await waitForExit(startSupervisor(wrongMode));
    expect(wrongModeResult.code).toBe(0);
    expect((await stat(wrongMode.state)).mode & 0o777).toBe(0o755);
    expect(await pathExists(join(wrongMode.state, "status.json"))).toBe(false);

    const direct = await createFixture();
    const actualState = `${direct.state}.actual`;
    await rename(direct.state, actualState);
    await symlink(actualState, direct.state);
    expect((await waitForExit(startSupervisor(direct))).code).toBe(0);
    expect((await lstat(direct.state)).isSymbolicLink()).toBe(true);
    expect(await pathExists(join(actualState, "status.json"))).toBe(false);

    const parent = await createFixture();
    const actualParent = join(parent.root, "actual-state-parent");
    const linkedParent = join(parent.root, "linked-state-parent");
    await mkdir(actualParent, { mode: 0o700 });
    await mkdir(join(actualParent, "state"), { mode: 0o700 });
    await symlink(actualParent, linkedParent);
    const linkedFixture = { ...parent, state: join(linkedParent, "state") };
    expect((await waitForExit(startSupervisor(linkedFixture))).code).toBe(0);
    expect(await pathExists(join(actualParent, "state", "status.json"))).toBe(false);
  });

  it("derives USER and LOGNAME for the sparse child environment when both are absent", async () => {
    const fixture = await createFixture("exit:255");
    const supervisor = startSupervisor(fixture, { maxChildExits: 1, omitUserIdentity: true });
    expect((await waitForExit(supervisor)).code).toBe(0);
    const expectedUser = spawnSync("/usr/bin/id", ["-un"], { encoding: "utf8" }).stdout.trim();
    const environment = await readFile(join(fixture.fakeState, "env.1"), "utf8");
    expect(environment).toContain(`USER=${expectedUser}\n`);
    expect(environment).toContain(`LOGNAME=${expectedUser}\n`);
  }, 30_000);

  it("keeps status and logs atomic, bounded to metadata keys, and child environment sparse", async () => {
    const fixture = await createFixture("exit:255");
    const supervisor = startSupervisor(fixture, {
      backoffs: "0.01,0.01,0.01,0.01,0.01",
      maxChildExits: 3,
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
  }, 30_000);
});
