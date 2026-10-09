import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";

// Claude sessions run through the real SDK adapter against a fake Agent SDK, so the
// test sees the environment the Claude process would actually receive.
const sdkQueryOptions = vi.hoisted(() => [] as any[]);
vi.mock("@anthropic-ai/claude-agent-sdk", async () =>
  (await import("./claude-sdk-test-helpers.js")).fakeAgentSdkModule(sdkQueryOptions),
);

vi.mock("node:crypto", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    randomUUID: () => "test-session-id",
    randomBytes: (n: number) => ({ toString: () => "a".repeat(n * 2) }),
  };
});

const mockResolveBinary = vi.hoisted(() => vi.fn((_name: string): string | null => "/usr/bin/claude"));
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

vi.mock("./codex-adapter.js", () => ({
  CodexAdapter: class {
    onInitError() {}
  },
}));

import { CliLauncher } from "./cli-launcher.js";
import { SessionStore } from "./session-store.js";

function createMockProc(pid = 12345) {
  return {
    pid,
    kill: vi.fn(),
    exited: new Promise<number>(() => {}),
    stdout: null,
    stderr: null,
  };
}

function createMockCodexProc(pid = 12345) {
  return {
    ...createMockProc(pid),
    stdin: new WritableStream<Uint8Array>(),
  };
}

async function waitForSpawnCalls(count: number) {
  const deadline = Date.now() + 2000;
  while (mockSpawn.mock.calls.length < count) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${count} spawn calls`);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

const INHERITED_OTEL_ENV = {
  OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: "http://localhost:14318/v1/logs",
  OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
  OTEL_SERVICE_NAME: "companion-test",
};

/** What a server started inside Claude Desktop inherits (abridged), plus a provider setting to keep. */
const INHERITED_PARENT_CLAUDE_ENV = {
  CLAUDECODE: "1",
  CLAUDE_CODE_ENTRYPOINT: "claude-desktop-3p",
  CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: "1",
  CLAUDE_CODE_HOST_AUTH_ENV_VAR: "ANTHROPIC_AUTH_TOKEN",
  ANTHROPIC_AUTH_TOKEN: "desktop-host-token",
  CLAUDE_CODE_SESSION_ID: "parent-session",
  ANTHROPIC_BASE_URL: "https://proxy.example",
};

async function withInheritedEnv(vars: Record<string, string>, run: () => Promise<void>) {
  const previous = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]));
  Object.assign(process.env, vars);
  try {
    await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) restoreEnvValue(key, value);
  }
}

/** The parent session's variables are gone; the user's provider setting stays. */
function expectNoParentClaudeEnv(env: Record<string, string | undefined>) {
  for (const key of Object.keys(INHERITED_PARENT_CLAUDE_ENV)) {
    if (key === "ANTHROPIC_BASE_URL") expect(env[key]).toBe("https://proxy.example");
    else expect(env[key], key).toBeUndefined();
  }
}

function restoreEnvValue(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
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
  sdkQueryOptions.length = 0;
  tempDir = mkdtempSync(join(tmpdir(), "launcher-telemetry-env-test-"));
  store = new SessionStore(tempDir);
  launcher = new CliLauncher(3456, { serverId: "test-server-id" });
  launcher.setStore(store);
  mockResolveBinary.mockReturnValue("/usr/bin/claude");
  mockGetEnrichedPath.mockReturnValue("/usr/bin:/usr/local/bin");
  mockCaptureUserShellEnv.mockReturnValue({});
  mockLegacyCodexHome.mockReturnValue(join(tempDir, "missing-legacy-codex-home"));
  mockSpawn.mockImplementation(() => createMockProc());
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

describe("launcher telemetry env stripping", () => {
  it("strips inherited OTEL env vars from host Claude sessions", async () => {
    await withInheritedEnv(INHERITED_OTEL_ENV, async () => {
      await launcher.launch({ cwd: "/tmp/project" });

      await vi.waitFor(() => expect(sdkQueryOptions.at(-1)?.env?.COMPANION_SESSION_ID).toBe("test-session-id"));
      const { env } = sdkQueryOptions.at(-1);
      expect(env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT).toBeUndefined();
      expect(env.OTEL_EXPORTER_OTLP_PROTOCOL).toBeUndefined();
      expect(env.OTEL_SERVICE_NAME).toBeUndefined();
    });
  });

  it("strips inherited OTEL env vars from host Codex sessions", async () => {
    await withInheritedEnv(INHERITED_OTEL_ENV, async () => {
      const customHome = mkdtempSync(join(tempDir, "codex-home-"));
      mockResolveBinary.mockReturnValue("/opt/fake/codex");
      mockSpawn.mockImplementation(() => createMockCodexProc());

      await launcher.launch({
        backendType: "codex",
        cwd: "/tmp/project",
        codexSandbox: "workspace-write",
        codexHome: customHome,
      });
      await waitForSpawnCalls(1);

      const [, options] = mockSpawn.mock.calls[0];
      expect(options.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT).toBeUndefined();
      expect(options.env.OTEL_EXPORTER_OTLP_PROTOCOL).toBeUndefined();
      expect(options.env.OTEL_SERVICE_NAME).toBeUndefined();
    });
  });
});

describe("launcher parent Claude Code session env stripping", () => {
  // A Takode server started from inside a Claude Code session must not pass
  // that session's login routing on: launched Claudes would report "Not logged in".
  it("strips a parent Claude session's variables from host Claude sessions", async () => {
    await withInheritedEnv(INHERITED_PARENT_CLAUDE_ENV, async () => {
      await launcher.launch({ cwd: "/tmp/project" });

      await vi.waitFor(() => expect(sdkQueryOptions.at(-1)?.env?.COMPANION_SESSION_ID).toBe("test-session-id"));
      expectNoParentClaudeEnv(sdkQueryOptions.at(-1).env);
    });
  });

  it("strips a parent Claude session's variables from host Codex sessions", async () => {
    await withInheritedEnv(INHERITED_PARENT_CLAUDE_ENV, async () => {
      const customHome = mkdtempSync(join(tempDir, "codex-home-"));
      mockResolveBinary.mockReturnValue("/opt/fake/codex");
      mockSpawn.mockImplementation(() => createMockCodexProc());

      await launcher.launch({
        backendType: "codex",
        cwd: "/tmp/project",
        codexSandbox: "workspace-write",
        codexHome: customHome,
      });
      await waitForSpawnCalls(1);

      const [, options] = mockSpawn.mock.calls[0];
      expectNoParentClaudeEnv(options.env);
    });
  });
});
