import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClaudeSdkAdapter } from "./claude-sdk-adapter.js";
import { RemoteProcess } from "./remote-host/host-link-manager.js";

/**
 * Uses the real Agent SDK. The session hands its `cwd` to the spawn itself, so
 * the server never changes its own working directory to start Claude there,
 * and a remote host's path (which does not exist on this machine) reaches the
 * host untouched instead of failing a local chdir.
 */
describe("ClaudeSdkAdapter working directory", () => {
  const dirs: string[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("starts a local Claude process in the session's folder", async () => {
    // A stand-in executable that records where it was started and exits.
    const scriptDir = mkdtempSync(join(tmpdir(), "sdk-cwd-script-"));
    const sessionDir = mkdtempSync(join(tmpdir(), "sdk-cwd-session-"));
    dirs.push(scriptDir, sessionDir);
    const record = join(scriptDir, "cwd.txt");
    const script = join(scriptDir, "fake-claude");
    writeFileSync(script, `#!/bin/sh\npwd -P > '${record}'\n`);
    chmodSync(script, 0o755);
    const serverCwd = process.cwd();

    const adapter = new ClaudeSdkAdapter("local-cwd", {
      cwd: sessionDir,
      claudeBinary: script,
      env: {},
    });
    await expect(adapter.started).resolves.toBe(true);
    await vi.waitFor(() => expect(readFileSync(record, "utf-8").trim()).toBe(realpathSync(sessionDir)));
    expect(process.cwd()).toBe(serverCwd);
    await adapter.disconnect();
  });

  it("passes a remote session's folder to its host without a local chdir", async () => {
    const warn = vi.spyOn(console, "warn");
    const serverCwd = process.cwd();
    const spawnProcess = vi.fn((_options: { cwd?: string }) => new RemoteProcess("remote-proc", () => {}));

    const adapter = new ClaudeSdkAdapter("remote-cwd", {
      cwd: "/home/someone-else/checkout-only-on-the-host",
      env: {},
      spawnProcess,
    });
    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(1));
    expect(spawnProcess.mock.calls[0]![0]).toMatchObject({
      cwd: "/home/someone-else/checkout-only-on-the-host",
    });
    expect(process.cwd()).toBe(serverCwd);
    expect(warn.mock.calls.flat().join(" ")).not.toContain("chdir");
    await adapter.disconnect();
  });
});
