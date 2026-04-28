import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

vi.mock("./codex-adapter.js", () => ({
  CodexAdapter: class {
    onInitError() {}
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

  it("preserves explicit OPENAI_API_KEY even when session auth.json is copied", async () => {
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

    expect(readFileSync(sessionAuth, "utf-8")).toBe('{"tokens":{"id_token":"legacy"}}\n');
    const [, options] = mockSpawn.mock.calls[0];
    expect(options.env.OPENAI_API_KEY).toBe("sk-test");
  });
});
