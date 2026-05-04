import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";

vi.mock("node:crypto", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    randomUUID: () => "test-session-id",
    randomBytes: (n: number) => ({ toString: () => "a".repeat(n * 2) }),
  };
});

const mockResolveBinary = vi.hoisted(() => vi.fn((_name: string): string | null => "/opt/fake/codex"));
const mockGetEnrichedPath = vi.hoisted(() => vi.fn(() => "/usr/bin:/usr/local/bin"));
const mockCaptureUserShellEnv = vi.hoisted(() => vi.fn((): Record<string, string> => ({})));
vi.mock("./path-resolver.js", () => ({
  resolveBinary: mockResolveBinary,
  getEnrichedPath: mockGetEnrichedPath,
  captureUserShellEnv: mockCaptureUserShellEnv,
}));

const mockLegacyCodexHome = vi.hoisted(() => vi.fn(() => "/tmp/nonexistent-codex-home"));
vi.mock("./codex-home.js", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    getLegacyCodexHome: mockLegacyCodexHome,
  };
});

const mockCodexInitErrorCallbacks = vi.hoisted(() => [] as Array<(error: string) => void>);
const mockCodexAdapterOptions = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock("./codex-adapter.js", () => ({
  CodexAdapter: class {
    constructor(_proc: unknown, _sessionId: string, options: Record<string, unknown>) {
      mockCodexAdapterOptions.push(options);
    }

    onInitError(cb: (error: string) => void) {
      mockCodexInitErrorCallbacks.push(cb);
    }
  },
}));

import { SessionStore } from "./session-store.js";
import { CliLauncher } from "./cli-launcher.js";

function createMockCodexProc(pid = 12345) {
  let resolve: (code: number) => void;
  let exited = false;
  const exitedPromise = new Promise<number>((r) => {
    resolve = r;
  });
  const resolveExit = (code: number) => {
    if (exited) return;
    exited = true;
    resolve(code);
  };
  return {
    pid,
    kill: vi.fn((signal?: string) => {
      resolveExit(signal === "SIGKILL" ? 137 : 0);
    }),
    exited: exitedPromise,
    stdin: new WritableStream<Uint8Array>(),
    stdout: null,
    stderr: null,
  };
}

async function waitForSpawnCalls(count: number) {
  const deadline = Date.now() + 2000;
  while (mockSpawn.mock.calls.length < count) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${count} Codex spawn calls`);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

function dockerExecEnvValue(args: string[], key: string): string | undefined {
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] !== "-e") continue;
    const [name, ...valueParts] = args[i + 1].split("=");
    if (name === key) return valueParts.join("=");
  }
  return undefined;
}

const mockSpawn = vi.fn();
const bunGlobal = globalThis as typeof globalThis & { Bun?: any };
const hadBunGlobal = typeof bunGlobal.Bun !== "undefined";
const originalBunSpawn = hadBunGlobal ? bunGlobal.Bun!.spawn : undefined;
if (hadBunGlobal) {
  (bunGlobal.Bun as { spawn?: unknown }).spawn = mockSpawn;
} else {
  bunGlobal.Bun = { spawn: mockSpawn };
}

let tempDir: string;
let store: SessionStore;
let launcher: CliLauncher;

beforeEach(() => {
  vi.clearAllMocks();
  mockCodexInitErrorCallbacks.length = 0;
  mockCodexAdapterOptions.length = 0;
  tempDir = mkdtempSync(join(tmpdir(), "launcher-codex-env-test-"));
  store = new SessionStore(tempDir);
  launcher = new CliLauncher(3456, { serverId: "test-server-id" });
  launcher.setStore(store);
  mockResolveBinary.mockReturnValue("/opt/fake/codex");
  mockGetEnrichedPath.mockReturnValue("/usr/bin:/usr/local/bin");
  mockCaptureUserShellEnv.mockReturnValue({});
  mockLegacyCodexHome.mockReturnValue(join(tempDir, "missing-legacy-codex-home"));
  mockSpawn.mockImplementation(() => createMockCodexProc());
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

afterAll(() => {
  if (hadBunGlobal) {
    (bunGlobal.Bun as { spawn?: unknown }).spawn = originalBunSpawn;
  } else {
    delete bunGlobal.Bun;
  }
});

describe("Codex launch env", () => {
  it("enables Codex native multi-agent support in per-session config", async () => {
    const customHome = mkdtempSync(join(tempDir, "codex-home-test-"));
    const sessionHome = join(customHome, "test-session-id");
    const configPath = join(sessionHome, "config.toml");

    await launcher.launch({
      backendType: "codex",
      cwd: "/tmp/project",
      codexSandbox: "workspace-write",
      codexHome: customHome,
    });
    await waitForSpawnCalls(1);

    const updatedConfig = readFileSync(configPath, "utf-8");
    expect(updatedConfig).toContain("[features]");
    expect(updatedConfig).toContain("multi_agent = true");
    expect(updatedConfig).toContain("[shell_environment_policy]");
    expect(updatedConfig).toContain('"PATH"');
  });

  it("enforces noninteractive Git editors for host Codex and shell commands", async () => {
    // Codex filters child shell environment through config.toml, so process env
    // and shell_environment_policy both need the Git-specific editor keys.
    const customHome = mkdtempSync(join(tempDir, "codex-home-test-"));
    const sessionHome = join(customHome, "test-session-id");
    const configPath = join(sessionHome, "config.toml");

    await launcher.launch({
      backendType: "codex",
      cwd: "/tmp/project",
      codexSandbox: "workspace-write",
      codexHome: customHome,
      env: {
        GIT_EDITOR: "code --wait",
        GIT_SEQUENCE_EDITOR: "vim",
        EDITOR: "code --wait",
        VISUAL: "code --wait",
      },
    });
    await waitForSpawnCalls(1);

    const [, options] = mockSpawn.mock.calls[0];
    expect(options.env.GIT_EDITOR).toBe("true");
    expect(options.env.GIT_SEQUENCE_EDITOR).toBe("true");
    expect(options.env.EDITOR).toBe("code --wait");
    expect(options.env.VISUAL).toBe("code --wait");

    const updatedConfig = readFileSync(configPath, "utf-8");
    expect(updatedConfig).toContain('"GIT_EDITOR"');
    expect(updatedConfig).toContain('"GIT_SEQUENCE_EDITOR"');
  });

  it("passes noninteractive Git editors into containerized Codex sessions and generated config", async () => {
    // Container Codex can generate config.toml inside the docker exec script;
    // that generated config must preserve the shell-command Git editor policy.
    const customHome = mkdtempSync(join(tempDir, "codex-container-home-test-"));

    await launcher.launch({
      backendType: "codex",
      cwd: "/tmp/project",
      codexSandbox: "workspace-write",
      codexHome: customHome,
      codexLeaderContextWindowOverrideTokens: 1_000_000,
      containerId: "abc123def456",
      containerName: "companion-session-1",
      containerImage: "ubuntu:22.04",
      env: {
        GIT_EDITOR: "code --wait",
        GIT_SEQUENCE_EDITOR: "vim",
        EDITOR: "code --wait",
      },
    });
    await waitForSpawnCalls(1);

    const [cmdAndArgs] = mockSpawn.mock.calls[0];
    expect(dockerExecEnvValue(cmdAndArgs, "GIT_EDITOR")).toBe("true");
    expect(dockerExecEnvValue(cmdAndArgs, "GIT_SEQUENCE_EDITOR")).toBe("true");
    expect(dockerExecEnvValue(cmdAndArgs, "EDITOR")).toBe("code --wait");

    const bashIndex = cmdAndArgs.indexOf("-lc");
    expect(bashIndex).toBeGreaterThan(-1);
    const innerScript = cmdAndArgs[bashIndex + 1];
    expect(innerScript).toContain('"GIT_EDITOR"');
    expect(innerScript).toContain('"GIT_SEQUENCE_EDITOR"');
  });

  it("passes explicit OPENAI_API_KEY through host Codex env when no session auth.json is available", async () => {
    const customHome = mkdtempSync(join(tempDir, "codex-home-"));
    const sessionHome = join(customHome, "test-session-id");
    const configPath = join(sessionHome, "config.toml");

    await launcher.launch({
      backendType: "codex",
      cwd: "/tmp/project",
      codexSandbox: "workspace-write",
      codexHome: customHome,
      env: { OPENAI_API_KEY: "sk-test" },
    });
    await waitForSpawnCalls(1);

    const updatedConfig = readFileSync(configPath, "utf-8");
    expect(updatedConfig).toContain("[shell_environment_policy]");
    expect(updatedConfig).not.toContain("companion-openai-env");
    const [, options] = mockSpawn.mock.calls[0];
    expect(options.env.OPENAI_API_KEY).toBe("sk-test");
  });

  it("preserves explicit OPENAI_API_KEY while linking session auth.json to the shared source", async () => {
    const legacyHome = join(tempDir, "legacy-codex-home");
    const customHome = mkdtempSync(join(tempDir, "codex-home-"));
    const sessionHome = join(customHome, "test-session-id");
    const legacyAuth = join(legacyHome, "auth.json");
    const sessionAuth = join(sessionHome, "auth.json");
    mkdirSync(legacyHome, { recursive: true });
    writeFileSync(legacyAuth, '{"tokens":{"id_token":"legacy"}}\n', "utf-8");
    mockLegacyCodexHome.mockReturnValue(legacyHome);

    await launcher.launch({
      backendType: "codex",
      cwd: "/tmp/project",
      codexSandbox: "workspace-write",
      codexHome: customHome,
      env: { OPENAI_API_KEY: "sk-test" },
    });
    await waitForSpawnCalls(1);

    expect(lstatSync(sessionAuth).isSymbolicLink()).toBe(true);
    expect(readlinkSync(sessionAuth)).toBe(legacyAuth);
    expect(readFileSync(sessionAuth, "utf-8")).toBe('{"tokens":{"id_token":"legacy"}}\n');
    const [, options] = mockSpawn.mock.calls[0];
    expect(options.env.OPENAI_API_KEY).toBe("sk-test");
  });

  it("preserves cliSessionId after transient Codex init transport closes", async () => {
    const session = await launcher.launch({
      backendType: "codex",
      cwd: "/tmp/project",
      codexSandbox: "workspace-write",
      env: { OPENAI_API_KEY: "sk-test" },
    });
    await waitForSpawnCalls(1);
    session.cliSessionId = "thread-existing";

    mockCodexInitErrorCallbacks[0]?.("Codex initialization failed: Transport closed");

    expect(session.cliSessionId).toBe("thread-existing");
    expect(session.state).toBe("exited");
  });

  it("relaunches with the preserved Codex thread after a transient init transport close", async () => {
    const session = await launcher.launch({
      backendType: "codex",
      cwd: "/tmp/project",
      codexSandbox: "workspace-write",
      env: { OPENAI_API_KEY: "sk-test" },
    });
    await waitForSpawnCalls(1);
    session.cliSessionId = "thread-existing";

    mockCodexInitErrorCallbacks[0]?.("Codex initialization failed: Transport closed");
    await launcher.relaunch(session.sessionId);
    await waitForSpawnCalls(2);

    expect(mockCodexAdapterOptions[1]?.threadId).toBe("thread-existing");
  });
});
