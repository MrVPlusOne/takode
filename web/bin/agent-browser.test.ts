import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

let tempDir: string;
let fakeBinDir: string;
let fakeScreenshotPath: string;
let delegateArgsPath: string;
let caffeinateArgsPath: string;
let delegatePidPath: string;
let delegateSessionPath: string;

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "agent-browser-shim-test-"));
  fakeBinDir = join(tempDir, "fake-bin");
  fakeScreenshotPath = join(tempDir, "source.png");
  delegateArgsPath = join(tempDir, "delegate-args.txt");
  caffeinateArgsPath = join(tempDir, "caffeinate-args.txt");
  delegatePidPath = join(tempDir, "delegate.pid");
  delegateSessionPath = join(tempDir, "delegate-session.txt");
  await mkdir(fakeBinDir, { recursive: true });
  await writeFile(
    fakeScreenshotPath,
    await sharp({
      create: { width: 2100, height: 1400, channels: 4, background: { r: 120, g: 60, b: 10, alpha: 1 } },
    })
      .png()
      .toBuffer(),
  );
  installFakeDelegate();
  installFakeCaffeinate();
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("agent-browser shim", () => {
  it("passes non-screenshot commands to the delegate unchanged", () => {
    const result = runShim(["status", "--verbose"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("delegate:status --verbose");
    expect(readFileSync(delegateArgsPath, "utf-8").trim()).toBe("status --verbose");
  });

  it("passes global-option non-screenshot commands to the delegate unchanged", () => {
    const result = runShim(["--session", "q-1035-review", "status", "--verbose"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("delegate:--session q-1035-review status --verbose");
    expect(readFileSync(delegateArgsPath, "utf-8").trim()).toBe("--session q-1035-review status --verbose");
  });

  it("optimizes screenshot JSON output to a marked sibling while preserving the original", async () => {
    const originalPath = join(tempDir, "shot.png");
    const result = runShim(["screenshot", originalPath, "--json"]);

    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout) as { data: { path: string; originalPath: string } };
    expect(payload.data.originalPath).toBe(originalPath);
    expect(payload.data.path).toBe(join(tempDir, "shot.takode-agent.jpeg"));
    expect(existsSync(originalPath)).toBe(true);
    expect(existsSync(payload.data.path)).toBe(true);

    const optimizedMeta = await sharp(readFileSync(payload.data.path)).metadata();
    expect(optimizedMeta.format).toBe("jpeg");
    expect(optimizedMeta.width).toBeLessThanOrEqual(1920);
  });

  it("optimizes screenshot commands after global options", async () => {
    const originalPath = join(tempDir, "global-shot.png");
    const result = runShim(["--session", "q-1035-explore", "screenshot", originalPath, "--json"]);

    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout) as { data: { path: string; originalPath: string } };
    expect(payload.data.originalPath).toBe(originalPath);
    expect(payload.data.path).toBe(join(tempDir, "global-shot.takode-agent.jpeg"));
    expect(existsSync(originalPath)).toBe(true);
    expect(existsSync(payload.data.path)).toBe(true);
    expect(readFileSync(delegateArgsPath, "utf-8").trim()).toBe(
      `--session q-1035-explore screenshot ${originalPath} --json`,
    );

    const optimizedMeta = await sharp(readFileSync(payload.data.path)).metadata();
    expect(optimizedMeta.format).toBe("jpeg");
    expect(optimizedMeta.width).toBeLessThanOrEqual(1920);
  });

  it("honors --takode-original without forwarding the Takode-only flag", () => {
    const originalPath = join(tempDir, "original.png");
    const result = runShim(["screenshot", originalPath, "--takode-original", "--json"]);

    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout) as { data: { path: string } };
    expect(payload.data.path).toBe(originalPath);
    expect(existsSync(originalPath)).toBe(true);
    expect(existsSync(join(tempDir, "original.takode-agent.jpeg"))).toBe(false);
    expect(readFileSync(delegateArgsPath, "utf-8")).not.toContain("--takode-original");
  });

  it("honors --takode-original after global options without forwarding the Takode-only flag", () => {
    const originalPath = join(tempDir, "global-original.png");
    const result = runShim(["--session", "q-1035-explore", "screenshot", originalPath, "--takode-original", "--json"]);

    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout) as { data: { path: string } };
    expect(payload.data.path).toBe(originalPath);
    expect(existsSync(originalPath)).toBe(true);
    expect(existsSync(join(tempDir, "global-original.takode-agent.jpeg"))).toBe(false);
    expect(readFileSync(delegateArgsPath, "utf-8").trim()).toBe(
      `--session q-1035-explore screenshot ${originalPath} --json`,
    );
  });

  // Headless Chrome on macOS waits for a display frame before capturing, so a
  // screenshot hangs while the display sleeps. The shim wakes the display with
  // `caffeinate -u` for screenshots only, and only on macOS.
  it("wakes the display before screenshots on macOS only", async () => {
    const statusResult = runShim(["status"]);
    expect(statusResult.status).toBe(0);
    expect(existsSync(caffeinateArgsPath)).toBe(false);

    const result = runShim(["screenshot", join(tempDir, "wake.png"), "--json"]);
    expect(result.status).toBe(0);
    if (process.platform !== "darwin") {
      expect(existsSync(caffeinateArgsPath)).toBe(false);
      return;
    }
    // caffeinate is fire-and-forget, so it may finish after the shim exits.
    await vi.waitFor(() => expect(readFileSync(caffeinateArgsPath, "utf-8").trim()).toBe("-u -t 2"));
  });

  // Killing a hung shim used to leave the real screenshot process running,
  // which kept holding the browser session.
  it("forwards SIGTERM to a hung screenshot delegate", async () => {
    const shim = spawn(process.execPath, [shimPath(), "screenshot", join(tempDir, "hung.png")], {
      env: shimEnv({ FAKE_SCREENSHOT_HANG: "1", DELEGATE_PID_FILE: delegatePidPath }),
      stdio: "ignore",
    });
    const exited = new Promise<void>((resolveExit) => shim.on("close", () => resolveExit()));
    await vi.waitFor(() => expect(existsSync(delegatePidPath)).toBe(true), { timeout: 5000 });
    const delegatePid = Number(readFileSync(delegatePidPath, "utf-8").trim());

    shim.kill("SIGTERM");
    await exited;

    await vi.waitFor(() => expect(isAlive(delegatePid)).toBe(false), { timeout: 5000 });
  });

  // Parallel holders of the agent-browser pool must each drive their own
  // browser, so the shim picks the session mapped to the caller's slot.
  describe("lease slot sessions", () => {
    let leaseServer: Server;
    let leaseRequests: number;

    beforeEach(async () => {
      leaseRequests = 0;
      leaseServer = createServer((req, res) => {
        leaseRequests += 1;
        // Mirrors GET /api/resource-leases/:key, where another session holds slot 1.
        const authorized = req.headers["x-companion-auth-token"] === "test-token";
        res.writeHead(authorized && req.url === "/api/resource-leases/agent-browser" ? 200 : 404, {
          "Content-Type": "application/json",
        });
        res.end(
          JSON.stringify({
            resource: {
              resourceKey: "agent-browser",
              capacity: 3,
              leases: [
                { slot: 1, ownerSessionId: "other-session" },
                { slot: 2, ownerSessionId: "slot-holder" },
              ],
              waiters: [],
            },
          }),
        );
      });
      await new Promise<void>((resolveListen) => leaseServer.listen(0, resolveListen));
    });

    afterEach(async () => {
      await new Promise((resolveClose) => leaseServer.close(resolveClose));
    });

    function sessionEnv(sessionId: string): Record<string, string> {
      return {
        COMPANION_SESSION_ID: sessionId,
        COMPANION_AUTH_TOKEN: "test-token",
        COMPANION_PORT: String((leaseServer.address() as AddressInfo).port),
      };
    }

    it("drives the browser session of the caller's slot", async () => {
      const result = await runShimAsync(["open", "http://127.0.0.1:5182"], sessionEnv("slot-holder"));

      expect(result.code).toBe(0);
      expect(readFileSync(delegateSessionPath, "utf-8").trim()).toBe("takode-browser-2");
      expect(readFileSync(delegateArgsPath, "utf-8").trim()).toBe("open http://127.0.0.1:5182");
    });

    it("keeps the default session when the caller holds no slot", async () => {
      const result = await runShimAsync(["status"], sessionEnv("no-lease"));

      expect(result.code).toBe(0);
      expect(leaseRequests).toBe(1);
      expect(readFileSync(delegateSessionPath, "utf-8").trim()).toBe("");
    });

    it("leaves an explicitly chosen session alone without asking the server", async () => {
      const result = await runShimAsync(["--session", "manual", "status"], sessionEnv("slot-holder"));

      expect(result.code).toBe(0);
      expect(leaseRequests).toBe(0);
      expect(readFileSync(delegateSessionPath, "utf-8").trim()).toBe("");
    });

    it("warns and keeps the default session when the lease lookup fails", async () => {
      const result = await runShimAsync(["status"], { ...sessionEnv("slot-holder"), COMPANION_AUTH_TOKEN: "bad" });

      expect(result.code).toBe(0);
      expect(result.stderr).toContain("could not look up your agent-browser lease slot");
      expect(readFileSync(delegateSessionPath, "utf-8").trim()).toBe("");
    });
  });

  it("fails clearly when no external delegate is available", () => {
    const result = runShim(["status"], { PATH: "/usr/bin:/bin" });

    expect(result.status).toBe(127);
    expect(result.stderr).toContain("real agent-browser binary not found");
  });
});

function runShim(args: string[], envOverrides: Record<string, string> = {}) {
  return spawnSync(process.execPath, [shimPath(), ...args], { env: shimEnv(envOverrides), encoding: "utf-8" });
}

/** Async variant for tests whose in-process lease server must keep answering. */
function runShimAsync(
  args: string[],
  envOverrides: Record<string, string>,
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [shimPath(), ...args], { env: shimEnv(envOverrides) });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (code) => resolveRun({ code, stderr }));
  });
}

function shimPath(): string {
  return fileURLToPath(new URL("./agent-browser.ts", import.meta.url));
}

function shimEnv(envOverrides: Record<string, string>): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: tempDir,
    PATH: `${fakeBinDir}:/usr/bin:/bin`,
    FAKE_SCREENSHOT_SOURCE: fakeScreenshotPath,
    DELEGATE_ARGS_FILE: delegateArgsPath,
    CAFFEINATE_ARGS_FILE: caffeinateArgsPath,
    DELEGATE_SESSION_FILE: delegateSessionPath,
    TMPDIR: tempDir,
    // Never let the shim's lease lookup reach the live server from a test.
    COMPANION_SESSION_ID: "",
    COMPANION_AUTH_TOKEN: "",
    COMPANION_PORT: "",
    TAKODE_API_PORT: "",
    AGENT_BROWSER_SESSION: "",
    ...envOverrides,
  };
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Records its arguments instead of waking the real display during tests. */
function installFakeCaffeinate(): void {
  const caffeinatePath = join(fakeBinDir, "caffeinate");
  writeFileSync(caffeinatePath, `#!/bin/sh\nprintf '%s\\n' "$*" > "$CAFFEINATE_ARGS_FILE"\n`, "utf-8");
  chmodSync(caffeinatePath, 0o755);
}

function installFakeDelegate(): void {
  const delegatePath = join(fakeBinDir, "agent-browser");
  writeFileSync(
    delegatePath,
    `#!/bin/sh
original_args="$*"
printf '%s\\n' "$*" > "$DELEGATE_ARGS_FILE"
printf '%s\\n' "$AGENT_BROWSER_SESSION" > "$DELEGATE_SESSION_FILE"
cmd=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --session|--browser|--url|--viewport|--timeout)
      shift 2
      ;;
    --session=*|--browser=*|--url=*|--viewport=*|--timeout=*)
      shift
      ;;
    --*)
      shift
      ;;
    *)
      cmd="$1"
      break
      ;;
  esac
done
if [ "$cmd" != "screenshot" ]; then
  echo "delegate:$original_args"
  exit 0
fi
shift
if [ "$FAKE_SCREENSHOT_HANG" = "1" ]; then
  echo $$ > "$DELEGATE_PID_FILE"
  exec sleep 30
fi
json=0
path=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --json|--json=*) json=1; shift ;;
    --screenshot-format|--screenshot-quality) shift 2 ;;
    --*) shift ;;
    *) if [ -z "$path" ]; then path="$1"; fi; shift ;;
  esac
done
if [ -z "$path" ]; then
  path="\${AGENT_BROWSER_SCREENSHOT_DIR:-$TMPDIR}/fake-screenshot.png"
fi
mkdir -p "$(dirname "$path")"
cp "$FAKE_SCREENSHOT_SOURCE" "$path"
if [ "$json" = "1" ]; then
  printf '{"success":true,"data":{"path":"%s"}}\\n' "$path"
else
  printf '%s\\n' "$path"
fi
`,
    "utf-8",
  );
  chmodSync(delegatePath, 0o755);
}
