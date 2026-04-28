import { mkdtempSync, rmSync } from "node:fs";
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

async function withInheritedOtelEnv(run: () => Promise<void>) {
  const previousLogsEndpoint = process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT;
  const previousProtocol = process.env.OTEL_EXPORTER_OTLP_PROTOCOL;
  const previousServiceName = process.env.OTEL_SERVICE_NAME;

  process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = "http://localhost:14318/v1/logs";
  process.env.OTEL_EXPORTER_OTLP_PROTOCOL = "http/protobuf";
  process.env.OTEL_SERVICE_NAME = "companion-test";

  try {
    await run();
  } finally {
    restoreEnvValue("OTEL_EXPORTER_OTLP_LOGS_ENDPOINT", previousLogsEndpoint);
    restoreEnvValue("OTEL_EXPORTER_OTLP_PROTOCOL", previousProtocol);
    restoreEnvValue("OTEL_SERVICE_NAME", previousServiceName);
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
    await withInheritedOtelEnv(async () => {
      await launcher.launch({ cwd: "/tmp/project" });

      const [, options] = mockSpawn.mock.calls[0];
      expect(options.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT).toBeUndefined();
      expect(options.env.OTEL_EXPORTER_OTLP_PROTOCOL).toBeUndefined();
      expect(options.env.OTEL_SERVICE_NAME).toBeUndefined();
    });
  });

  it("strips inherited OTEL env vars from host Codex sessions", async () => {
    await withInheritedOtelEnv(async () => {
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
