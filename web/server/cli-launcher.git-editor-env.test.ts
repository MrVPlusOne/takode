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
vi.mock("./path-resolver.js", () => ({
  resolveBinary: mockResolveBinary,
  getEnrichedPath: mockGetEnrichedPath,
}));

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
  tempDir = mkdtempSync(join(tmpdir(), "launcher-git-editor-env-test-"));
  store = new SessionStore(tempDir);
  launcher = new CliLauncher(3456, { serverId: "test-server-id" });
  launcher.setStore(store);
  mockResolveBinary.mockReturnValue("/usr/bin/claude");
  mockGetEnrichedPath.mockReturnValue("/usr/bin:/usr/local/bin");
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

describe("launcher Git editor env", () => {
  it("enforces noninteractive Git editors for host Claude sessions", async () => {
    // Regression coverage: agent launch policy must win over user/env-profile
    // Git editor settings while leaving generic editor variables alone.
    await launcher.launch({
      cwd: "/tmp",
      env: {
        GIT_EDITOR: "code --wait",
        GIT_SEQUENCE_EDITOR: "vim",
        EDITOR: "code --wait",
        VISUAL: "code --wait",
      },
    });

    const [, options] = mockSpawn.mock.calls[0];
    expect(options.env.GIT_EDITOR).toBe("true");
    expect(options.env.GIT_SEQUENCE_EDITOR).toBe("true");
    expect(options.env.EDITOR).toBe("code --wait");
    expect(options.env.VISUAL).toBe("code --wait");
  });

  it("passes noninteractive Git editors into containerized Claude sessions", async () => {
    // Containerized agents receive session env through docker exec -e rather
    // than Bun.spawn env, so verify the policy crosses that boundary.
    await launcher.launch({
      cwd: "/tmp/project",
      containerId: "abc123def456",
      containerName: "companion-session-1",
      env: {
        GIT_EDITOR: "code --wait",
        GIT_SEQUENCE_EDITOR: "vim",
        EDITOR: "code --wait",
      },
    });

    const [cmdAndArgs] = mockSpawn.mock.calls[0];
    expect(dockerExecEnvValue(cmdAndArgs, "GIT_EDITOR")).toBe("true");
    expect(dockerExecEnvValue(cmdAndArgs, "GIT_SEQUENCE_EDITOR")).toBe("true");
    expect(dockerExecEnvValue(cmdAndArgs, "EDITOR")).toBe("code --wait");
  });
});
