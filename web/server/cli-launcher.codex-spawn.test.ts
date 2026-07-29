import { vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir, hostname, tmpdir } from "node:os";

vi.mock("node:crypto", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    randomUUID: () => "test-session-id",
    randomBytes: (n: number) => ({ toString: () => "a".repeat(n * 2) }),
  };
});

const mockExec = vi.hoisted(() =>
  vi.fn((_cmd: string, _opts: any, cb: any) => {
    if (typeof _opts === "function") {
      _opts(null, "", "");
      return;
    }
    if (cb) cb(null, "", "");
  }),
);
vi.mock("node:child_process", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    exec: mockExec,
  };
});

const mockResolveBinary = vi.hoisted(() => vi.fn((_name: string): string | null => "/opt/fake/codex"));
const mockGetEnrichedPath = vi.hoisted(() => vi.fn(() => "/usr/bin:/usr/local/bin"));
const mockCaptureUserShellPath = vi.hoisted(() => vi.fn(() => "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"));
const mockCaptureUserShellEnv = vi.hoisted(() => vi.fn((): Record<string, string> => ({})));
vi.mock("./path-resolver.js", () => ({
  resolveBinary: mockResolveBinary,
  getEnrichedPath: mockGetEnrichedPath,
  captureUserShellPath: mockCaptureUserShellPath,
  captureUserShellEnv: mockCaptureUserShellEnv,
}));

vi.mock("./container-manager.js", () => ({
  containerManager: {
    isContainerAlive: () => "running",
    hasBinaryInContainer: () => true,
    startContainer: vi.fn(),
  },
}));

import { SessionStore } from "./session-store.js";
import { CliLauncher, type LaunchOptions } from "./cli-launcher.js";

const mockSpawn = vi.fn();
const bunGlobal = globalThis as typeof globalThis & { Bun?: any };
const hadBunGlobal = typeof bunGlobal.Bun !== "undefined";
const originalBunSpawn = hadBunGlobal ? bunGlobal.Bun!.spawn : undefined;
if (hadBunGlobal) {
  (bunGlobal.Bun as { spawn?: unknown }).spawn = mockSpawn;
} else {
  bunGlobal.Bun = { spawn: mockSpawn };
}

function createMockCodexProc(pid = 12345) {
  return {
    pid,
    kill: vi.fn(),
    exited: new Promise<number>(() => {}),
    stdin: new WritableStream<Uint8Array>(),
    stdout: new ReadableStream<Uint8Array>(),
    stderr: new ReadableStream<Uint8Array>(),
  };
}

function normalizeMaiHostname(input: string): string {
  let normalized = input.replace(/[^A-Za-z0-9._-]/g, "-");
  while (normalized.length > 0 && /^[._-]/.test(normalized)) normalized = normalized.slice(1);
  while (normalized.length > 0 && /[._-]$/.test(normalized)) normalized = normalized.slice(0, -1);
  if (normalized.length > 64) {
    normalized = normalized.slice(0, 64);
    while (normalized.length > 0 && /[._-]$/.test(normalized)) normalized = normalized.slice(0, -1);
  }
  return normalized || "host";
}

function writeMaiWrapperHostEnv(wrapperRoot: string, hostCodexHome: string): void {
  mkdirSync(join(wrapperRoot, ".run"), { recursive: true });
  const hostNames = new Set([hostname(), hostname().split(".")[0] || hostname()]);
  for (const hostName of hostNames) {
    writeFileSync(
      join(wrapperRoot, ".run", `.env-${normalizeMaiHostname(hostName)}`),
      [
        'LITELLM_API_KEY="sk-wrapper123"',
        'LITELLM_PROXY_URL="http://localhost:4000"',
        `CODEX_HOME="${hostCodexHome}"`,
        "",
      ].join("\n"),
      "utf-8",
    );
  }
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitForSpawnCalls(count: number): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (mockSpawn.mock.calls.length >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Expected ${count} spawn call(s), got ${mockSpawn.mock.calls.length}`);
}

async function waitForCondition(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Condition was not met");
}

describe("Codex spawn preparation", () => {
  let tempDir: string;
  let codexHome: string;
  let store: SessionStore;
  let launcher: CliLauncher;

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = mkdtempSync(join(tmpdir(), "launcher-spawn-test-"));
    codexHome = mkdtempSync(join(tmpdir(), "codex-home-test-"));
    store = new SessionStore(tempDir);
    launcher = new CliLauncher(3456, { serverId: "test-server-id" });
    launcher.setStore(store);
    mockSpawn.mockReturnValue(createMockCodexProc());
    mockResolveBinary.mockReturnValue("/opt/fake/codex");
    mockGetEnrichedPath.mockReturnValue("/usr/bin:/usr/local/bin");
    mockCaptureUserShellPath.mockReturnValue("/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin");
    mockCaptureUserShellEnv.mockReturnValue({});
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    rmSync(codexHome, { recursive: true, force: true });
    delete process.env.LITELLM_API_KEY;
  });

  afterAll(() => {
    if (hadBunGlobal) {
      (bunGlobal.Bun as { spawn?: unknown }).spawn = originalBunSpawn;
    } else {
      delete bunGlobal.Bun;
    }
  });

  async function launchCodex(options: LaunchOptions = {}) {
    const info = await launcher.launch({
      backendType: "codex",
      cwd: tempDir,
      codexSandbox: "workspace-write",
      codexHome,
      ...options,
    });
    await waitForSpawnCalls(1);
    return info;
  }

  it("preserves Companion/Takode env vars in Codex shell policy for orchestrators", async () => {
    // The session config must allow Takode env vars through Codex's filtered
    // shell policy while preserving unrelated user feature settings.
    const sessionHome = join(codexHome, "test-session-id");
    const configPath = join(sessionHome, "config.toml");
    mkdirSync(sessionHome, { recursive: true });
    writeFileSync(
      configPath,
      [
        'sandbox_mode = "workspace-write"',
        "",
        "[features]",
        "multi_agent = false",
        "other_feature = false",
        "",
        "[shell_environment_policy]",
        'inherit = "core"',
        "include_only = [",
        '    "PATH",',
        '    "HOME",',
        "]",
        "",
      ].join("\n"),
      "utf-8",
    );

    await launchCodex({
      env: {
        COMPANION_PORT: "3456",
        TAKODE_ROLE: "orchestrator",
        TAKODE_API_PORT: "3456",
      },
    });

    const [cmdAndArgs, options] = mockSpawn.mock.calls[0];
    expect(cmdAndArgs).toContain("app-server");
    expect(options.env.COMPANION_SERVER_ID).toBe("test-server-id");
    expect(options.env.COMPANION_SESSION_ID).toBe("test-session-id");
    expect(options.env.COMPANION_SESSION_NUMBER).toBeDefined();

    const updatedConfig = await Bun.file(configPath).text();
    expect(updatedConfig).toContain("[features]");
    expect(updatedConfig).toContain("multi_agent = true");
    expect(updatedConfig).not.toContain("multi_agent = false");
    expect(updatedConfig).toContain("other_feature = false");
    expect(updatedConfig).toContain('"PATH"');
    expect(updatedConfig).toContain('"HOME"');
    expect(updatedConfig).toContain('"COMPANION_SERVER_ID"');
    expect(updatedConfig).toContain('"COMPANION_SESSION_ID"');
    expect(updatedConfig).toContain('"COMPANION_SESSION_NUMBER"');
    expect(updatedConfig).toContain('"COMPANION_AUTH_TOKEN"');
    expect(updatedConfig).toContain('"COMPANION_PORT"');
    expect(updatedConfig).toContain('"TAKODE_ROLE"');
    expect(updatedConfig).toContain('"TAKODE_API_PORT"');
  });

  it("injects the Companion port for direct delegate child Codex launches", async () => {
    // Hidden delegate children are launched directly from the delegate route,
    // not through the session-create route that previously supplied
    // COMPANION_PORT. The launcher itself must inject the server port so the
    // child-only takode_delegate MCP can call end_delegation.
    const sessionHome = join(codexHome, "test-session-id");
    const configPath = join(sessionHome, "config.toml");

    await launchCodex({
      resumeCliSessionId: "forked-thread",
      hidden: true,
      parentSessionId: "parent-session",
      env: {
        TAKODE_DELEGATE_ROLE: "child",
        TAKODE_DELEGATE_ID: "del_123",
        TAKODE_DELEGATE_PARENT_SESSION_ID: "parent-session",
      },
    });

    const [, options] = mockSpawn.mock.calls[0];
    expect(options.env.COMPANION_PORT).toBe("3456");
    expect(options.env.COMPANION_SESSION_ID).toBe("test-session-id");
    expect(options.env.COMPANION_AUTH_TOKEN).toBeDefined();
    expect(options.env.TAKODE_DELEGATE_ROLE).toBe("child");

    const updatedConfig = await Bun.file(configPath).text();
    expect(updatedConfig).toContain("[mcp_servers.takode_delegate]");
    expect(updatedConfig).toContain("[mcp_servers.takode_delegate.env]");
    expect(updatedConfig).toContain('COMPANION_PORT = "3456"');
    expect(updatedConfig).toContain('COMPANION_SESSION_ID = "test-session-id"');
    expect(updatedConfig).toContain('TAKODE_DELEGATE_ROLE = "child"');
    expect(updatedConfig).toContain('"COMPANION_PORT"');
    expect(updatedConfig).toContain('"TAKODE_DELEGATE_ROLE"');
  });

  it("seeds forked Codex rollouts from the parent session home into hidden children", async () => {
    // Forked threads are written into the parent session-scoped Codex home.
    // Hidden native-fork children must copy that rollout before starting, or
    // Codex resumes will silently degrade into a fresh thread.
    const parentSessionId = "parent-session-id";
    const parentDay = join(codexHome, parentSessionId, "sessions", "2026", "07", "27");
    const rolloutName = "rollout-2026-07-27T13-07-22-forked-thread.jsonl";
    const childRollout = join(codexHome, "test-session-id", "sessions", "2026", "07", "27", rolloutName);
    mkdirSync(parentDay, { recursive: true });
    writeFileSync(join(parentDay, rolloutName), "parent fork rollout\n", "utf-8");

    await launchCodex({
      resumeCliSessionId: "forked-thread",
      codexResumeSourceSessionId: parentSessionId,
      requireResumeCliSessionId: true,
      hidden: true,
      parentSessionId,
      publicSessionNumber: false,
    });

    expect(await Bun.file(childRollout).text()).toBe("parent fork rollout\n");
    const [, options] = mockSpawn.mock.calls[0];
    expect(options.env.COMPANION_SESSION_ID).toBe("test-session-id");
  });

  it("allow-lists HOME for MAI-wrapper-backed Codex shell commands", async () => {
    // MAI-wrapper launches start with a session-local HOME/CODEX_HOME, but
    // Codex still filters tool shell env through config.toml. HOME must be in
    // that allow-list so HOME-based CLIs such as quest cannot fall back to the
    // live user home when model-driven shell tools run.
    const wrapperRoot = mkdtempSync(join(tmpdir(), "mai-wrapper-test-"));
    const hostCodexHome = join(wrapperRoot, "host-codex-home");
    const wrapperPath = join(wrapperRoot, "codex.sh");
    const sessionHome = join(codexHome, "test-session-id");
    const configPath = join(sessionHome, "config.toml");

    try {
      mkdirSync(hostCodexHome, { recursive: true });
      writeFileSync(join(wrapperRoot, ".mai-agents-root"), "", "utf-8");
      writeFileSync(
        join(hostCodexHome, "config.toml"),
        ['model_provider = "mai-litellm"', "", "[model_providers.mai-litellm]", 'env_key = "LITELLM_API_KEY"', ""].join(
          "\n",
        ),
        "utf-8",
      );
      writeFileSync(wrapperPath, "#!/usr/bin/env bash\necho wrapper placeholder\n", "utf-8");
      writeMaiWrapperHostEnv(wrapperRoot, hostCodexHome);
      mockResolveBinary.mockImplementation((name: string): string | null =>
        name === wrapperPath ? wrapperPath : "/opt/fake/codex",
      );

      await launchCodex({
        codexBinary: wrapperPath,
        env: {
          COMPANION_PORT: "3468",
          TAKODE_ROLE: "orchestrator",
          TAKODE_API_PORT: "3468",
        },
      });

      const [, options] = mockSpawn.mock.calls[0];
      expect(options.env.CODEX_HOME).toBe(sessionHome);
      expect(options.env.PATH.split(":")[0]).toBe(join(sessionHome, ".mai-wrapper-bin"));

      const wrapperEnv = await Bun.file(
        join(wrapperRoot, ".run", `.env-${normalizeMaiHostname("companion-codex-home-test-session-id")}`),
      ).text();
      expect(wrapperEnv).toContain(`CODEX_HOME='${sessionHome}'`);

      const updatedConfig = await Bun.file(configPath).text();
      expect(updatedConfig).toContain("[shell_environment_policy]");
      expect(updatedConfig).toContain('"HOME"');
      expect(updatedConfig).toContain('"PATH"');
      expect(updatedConfig).toContain('"COMPANION_PORT"');
      expect(updatedConfig).toContain('"TAKODE_API_PORT"');
    } finally {
      rmSync(wrapperRoot, { recursive: true, force: true });
    }
  });

  it("scrubs session-scoped developer instructions from an existing session config", async () => {
    // Existing Takode session homes can already contain stale guardrails; launch
    // prep should remove only that root key before Codex writes fresh ones.
    const sessionHome = join(codexHome, "test-session-id");
    const configPath = join(sessionHome, "config.toml");
    mkdirSync(sessionHome, { recursive: true });
    writeFileSync(
      configPath,
      [
        'model_provider = "mai-litellm"',
        'model = "gpt-5.5"',
        'model_reasoning_effort = "high"',
        'approval_policy = "on-request"',
        'sandbox_mode = "workspace-write"',
        'developer_instructions = """',
        "old Takode session guardrails",
        '"""',
        "",
        "[features]",
        "other_feature = true",
        "",
        "[model_providers.mai-litellm]",
        'name = "MAI LiteLLM"',
        'base_url = "http://localhost:4000/v1"',
        'env_key = "LITELLM_API_KEY"',
        'wire_api = "responses"',
        "",
      ].join("\n"),
      "utf-8",
    );

    await launchCodex({
      env: {
        COMPANION_PORT: "3456",
      },
    });

    const updatedConfig = await Bun.file(configPath).text();
    expect(updatedConfig).toContain('model_provider = "mai-litellm"');
    expect(updatedConfig).toContain('model = "gpt-5.5"');
    expect(updatedConfig).toContain('model_reasoning_effort = "high"');
    expect(updatedConfig).toContain('approval_policy = "on-request"');
    expect(updatedConfig).toContain('sandbox_mode = "workspace-write"');
    expect(updatedConfig).toContain("[features]");
    expect(updatedConfig).toContain("other_feature = true");
    expect(updatedConfig).toContain("multi_agent = true");
    expect(updatedConfig).toContain("image_generation = false");
    expect(updatedConfig).toContain("[model_providers.mai-litellm]");
    expect(updatedConfig).toContain('name = "MAI LiteLLM"');
    expect(updatedConfig).toContain('base_url = "http://localhost:4000/v1"');
    expect(updatedConfig).toContain('env_key = "LITELLM_API_KEY"');
    expect(updatedConfig).toContain('wire_api = "responses"');
    expect(updatedConfig).toMatch(/\[shell_environment_policy\][\s\S]*"LITELLM_API_KEY"/);
    expect(updatedConfig).not.toContain("developer_instructions");
    expect(updatedConfig).not.toContain("old Takode session guardrails");
  });

  it("passes non-leader usable context capacity with a matching auto-compact limit", async () => {
    // Model-switch relaunches need both values on the Codex command line.
    // Otherwise Codex may keep the larger context window while falling back to
    // a much lower built-in pre-sampling compaction threshold.
    await launchCodex({
      model: "gpt-5.6-sol",
      codexMaxContextLength: 650_000,
    });

    const [cmdAndArgs] = mockSpawn.mock.calls[0];
    expect(cmdAndArgs).toContain("-c");
    expect(cmdAndArgs).toContain("model=gpt-5.6-sol");
    expect(cmdAndArgs).toContain("model_context_window=684211");
    expect(cmdAndArgs).toContain("model_auto_compact_token_limit=585000");
  });

  it("builds host Codex PATH from enriched startup data without hot-path shell capture", async () => {
    // Spawn prep should reuse startup-warmed shell data; re-capturing a shell in
    // this path is slow and can stall session startup.
    mockCaptureUserShellPath.mockImplementation(() => {
      throw new Error("host Codex launch should not re-capture shell PATH");
    });
    mockCaptureUserShellEnv.mockReturnValue({ LITELLM_API_KEY: "startup-warmed-key" });
    mockGetEnrichedPath.mockReturnValue(
      "/opt/homebrew/bin:/Users/test/.bun/bin:/usr/local/share/companion-extra:/usr/bin:/bin",
    );
    process.env.LITELLM_API_KEY = "stale-daemon-key";

    await launchCodex({ codexInternetAccess: true });

    const [, options] = mockSpawn.mock.calls[0];
    const dirs = options.env.PATH.split(":");
    expect(dirs.slice(0, 6)).toEqual([
      "/opt/fake",
      join(homedir(), ".companion", "bin"),
      join(homedir(), ".local", "bin"),
      join(homedir(), ".bun", "bin"),
      "/opt/homebrew/bin",
      "/Users/test/.bun/bin",
    ]);
    expect(dirs).toContain("/usr/local/share/companion-extra");
    expect(options.env.LITELLM_API_KEY).toBe("startup-warmed-key");
    expect(mockCaptureUserShellEnv).toHaveBeenCalledWith(["LITELLM_API_KEY", "LITELLM_PROXY_URL", "LITELLM_BASE_URL"], {
      allowShellSpawn: false,
    });
    expect(mockCaptureUserShellPath).not.toHaveBeenCalled();
  });

  it("spawns codex via sibling node binary to bypass shebang issues", async () => {
    // Node-installed Codex scripts can have shebangs that resolve to an old
    // system node, so the launcher should prefer the sibling node binary.
    const tmpBinDir = mkdtempSync(join(tmpdir(), "codex-test-"));
    const fakeCodex = join(tmpBinDir, "codex");
    const fakeNode = join(tmpBinDir, "node");
    writeFileSync(fakeCodex, "#!/usr/bin/env node\n");
    writeFileSync(fakeNode, "#!/bin/sh\n");

    try {
      mockResolveBinary.mockReturnValue(fakeCodex);

      await launchCodex();

      const [cmdAndArgs] = mockSpawn.mock.calls[0];
      expect(cmdAndArgs[0]).toBe(fakeNode);
      expect(cmdAndArgs[1]).toContain("codex");
      expect(cmdAndArgs).toContain("app-server");
    } finally {
      rmSync(tmpBinDir, { recursive: true, force: true });
    }
  });

  it("does not invoke sibling node for a native codex binary", async () => {
    // Native Codex binaries must run directly; passing them to node would fail
    // even when a sibling node binary happens to exist.
    const tmpBinDir = mkdtempSync(join(tmpdir(), "codex-native-test-"));
    const fakeCodex = join(tmpBinDir, "codex");
    const fakeNode = join(tmpBinDir, "node");
    writeFileSync(fakeCodex, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x07, 0x00, 0x00, 0x01]));
    writeFileSync(fakeNode, "#!/bin/sh\n");

    try {
      mockResolveBinary.mockReturnValue(fakeCodex);

      await launchCodex();

      const [cmdAndArgs] = mockSpawn.mock.calls[0];
      expect(cmdAndArgs[0]).toBe(fakeCodex);
      expect(cmdAndArgs.slice(1, 7)).toEqual([
        "-c",
        "tools.webSearch=false",
        "-c",
        "model=gpt-5.6-sol",
        "-a",
        "untrusted",
      ]);
    } finally {
      rmSync(tmpBinDir, { recursive: true, force: true });
    }
  });

  it("sets state=exited and exitCode=127 when codex binary is not found", async () => {
    // Missing binary failures should become session state, not an attempted
    // spawn with a bogus command.
    mockResolveBinary.mockReturnValue(null);

    const info = await launcher.launch({
      backendType: "codex",
      cwd: tempDir,
      codexSandbox: "workspace-write",
      codexHome,
    });
    await waitForCondition(() => info.state === "exited");

    expect(info.exitCode).toBe(127);
    expect(mockSpawn).not.toHaveBeenCalled();
  });
});
