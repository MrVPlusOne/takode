import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock("node:child_process", () => ({ spawn: spawnMock }));

import { runCodexQuestCommand } from "./codex-quest-command-runner.js";

const ORIGINAL_COMPANION_ENV = {
  COMPANION_SESSION_ID: process.env.COMPANION_SESSION_ID,
  COMPANION_SESSION_NUMBER: process.env.COMPANION_SESSION_NUMBER,
  COMPANION_AUTH_TOKEN: process.env.COMPANION_AUTH_TOKEN,
  COMPANION_PORT: process.env.COMPANION_PORT,
  COMPANION_SERVER_ID: process.env.COMPANION_SERVER_ID,
  COMPANION_SERVER_SLUG: process.env.COMPANION_SERVER_SLUG,
  COMPANION_MEMORY_SPACE_SLUG: process.env.COMPANION_MEMORY_SPACE_SLUG,
  TAKODE_ROLE: process.env.TAKODE_ROLE,
  TAKODE_API_PORT: process.env.TAKODE_API_PORT,
};

afterEach(() => {
  vi.useRealTimers();
  spawnMock.mockReset();
  restoreEnvironment("COMPANION_SESSION_ID", ORIGINAL_COMPANION_ENV.COMPANION_SESSION_ID);
  restoreEnvironment("COMPANION_SESSION_NUMBER", ORIGINAL_COMPANION_ENV.COMPANION_SESSION_NUMBER);
  restoreEnvironment("COMPANION_AUTH_TOKEN", ORIGINAL_COMPANION_ENV.COMPANION_AUTH_TOKEN);
  restoreEnvironment("COMPANION_PORT", ORIGINAL_COMPANION_ENV.COMPANION_PORT);
  restoreEnvironment("COMPANION_SERVER_ID", ORIGINAL_COMPANION_ENV.COMPANION_SERVER_ID);
  restoreEnvironment("COMPANION_SERVER_SLUG", ORIGINAL_COMPANION_ENV.COMPANION_SERVER_SLUG);
  restoreEnvironment("COMPANION_MEMORY_SPACE_SLUG", ORIGINAL_COMPANION_ENV.COMPANION_MEMORY_SPACE_SLUG);
  restoreEnvironment("TAKODE_ROLE", ORIGINAL_COMPANION_ENV.TAKODE_ROLE);
  restoreEnvironment("TAKODE_API_PORT", ORIGINAL_COMPANION_ENV.TAKODE_API_PORT);
});

describe("Codex Quest command runner", () => {
  it("spawns the bundled CLI without a shell and replaces inherited Takode identity", async () => {
    // The child gets authoritative Codex provenance while inherited managed
    // session credentials are removed so they cannot select the Takode path.
    process.env.COMPANION_SESSION_ID = "spoofed-session";
    process.env.COMPANION_AUTH_TOKEN = "spoofed-token";
    process.env.COMPANION_PORT = "9999";
    process.env.COMPANION_SERVER_ID = "spoofed-server";
    const child = fakeChildProcess("exact stdout\n", "exact stderr\n", 0);
    let stdin = "";
    child.stdin.setEncoding("utf8");
    child.stdin.on("data", (chunk: string) => {
      stdin += chunk;
    });
    spawnMock.mockReturnValueOnce(child);

    const result = await runCodexQuestCommand({
      args: ["show", "q-7", "--json"],
      stdin: "input\n",
      actor: {
        kind: "codex_session",
        sessionId: "thread-1",
        turnId: "turn-2",
        toolUseId: "tool-3",
        cwd: "/repo",
      },
    });

    expect(result).toEqual({ exitCode: 0, stdout: "exact stdout\n", stderr: "exact stderr\n" });
    const [executable, argv, options] = spawnMock.mock.calls[0]!;
    expect(executable).toBe(process.execPath);
    expect(argv[0]).toMatch(/\/web\/bin\/quest\.ts$/);
    expect(argv.slice(1)).toEqual(["show", "q-7", "--json"]);
    expect(options).toMatchObject({ cwd: "/repo", shell: false, stdio: ["pipe", "pipe", "pipe"] });
    expect(options.env).toMatchObject({
      TAKODE_QUEST_SERVER_EXECUTION: "1",
      TAKODE_CODEX_SESSION_ID: "thread-1",
      TAKODE_CODEX_TURN_ID: "turn-2",
      TAKODE_CODEX_TOOL_USE_ID: "tool-3",
      TAKODE_CODEX_CWD: "/repo",
    });
    expect(options.env.COMPANION_SESSION_ID).toBeUndefined();
    expect(options.env.COMPANION_AUTH_TOKEN).toBeUndefined();
    expect(options.env.COMPANION_PORT).toBeUndefined();
    expect(options.env.COMPANION_SERVER_ID).toBeUndefined();
    expect(stdin).toBe("input\n");
  });

  it("force-terminates a CLI process that outlives the bounded request", async () => {
    // A wedged command must not survive after the HTTP caller has timed out.
    vi.useFakeTimers();
    const child = fakeChildProcess("", "", null);
    spawnMock.mockReturnValueOnce(child);

    const result = runCodexQuestCommand({
      args: ["show", "q-7"],
      actor: { kind: "codex_session", sessionId: "thread-1", cwd: "/repo" },
    });
    const rejected = expect(result).rejects.toThrow("Quest CLI timed out after 60000ms");
    await vi.advanceTimersByTimeAsync(60_000);

    await rejected;
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("does not inherit Takode leader authority for a direct Codex claim", async () => {
    // `quest claim` rejects orchestrators before checking Codex ownership, so
    // a server-launched direct Codex command must not see its parent's role.
    process.env.TAKODE_ROLE = "orchestrator";
    process.env.TAKODE_API_PORT = "3456";
    process.env.COMPANION_SESSION_NUMBER = "42";
    process.env.COMPANION_MEMORY_SPACE_SLUG = "Takode";
    const child = fakeChildProcess("claimed\n", "", 0);
    spawnMock.mockReturnValueOnce(child);

    const result = await runCodexQuestCommand({
      args: ["claim", "q-7"],
      actor: { kind: "codex_session", sessionId: "thread-1", cwd: "/repo" },
    });

    expect(result.exitCode).toBe(0);
    const [, argv, options] = spawnMock.mock.calls[0]!;
    expect(argv.slice(1)).toEqual(["claim", "q-7"]);
    expect(options.env.TAKODE_ROLE).toBeUndefined();
    expect(options.env.TAKODE_API_PORT).toBeUndefined();
    expect(options.env.COMPANION_SESSION_NUMBER).toBeUndefined();
    expect(options.env.COMPANION_MEMORY_SPACE_SLUG).toBeUndefined();
    expect(options.env.TAKODE_CODEX_SESSION_ID).toBe("thread-1");
  });
});

function fakeChildProcess(stdoutText: string, stderrText: string, exitCode: number | null) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    stdin: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = vi.fn();
  if (exitCode !== null) {
    queueMicrotask(() => {
      child.stdout.end(stdoutText);
      child.stderr.end(stderrText);
      child.emit("close", exitCode, null);
    });
  }
  return child;
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
