import { vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";

// ─── Hoisted mocks ──────────────────────────────────────────────────────────

// Mock randomUUID and randomBytes so session IDs and auth tokens are deterministic
vi.mock("node:crypto", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    randomUUID: () => "test-session-id",
    randomBytes: (n: number) => ({ toString: () => "a".repeat(n * 2) }),
  };
});

// Mock child_process.exec to prevent actual git commands from running in tests
const mockExec = vi.hoisted(() =>
  vi.fn((_cmd: string, _opts: any, cb: any) => {
    if (_cmd.includes("git --no-optional-locks ls-files --error-unmatch --")) {
      const err = Object.assign(new Error("Command failed: git ls-files"), {
        code: 1,
        stderr: "error: pathspec '.claude/settings.json' did not match any file(s) known to git",
      });
      if (typeof _opts === "function") {
        _opts(err, "", "");
        return;
      }
      if (cb) cb(err, "", "");
      return;
    }
    // Simulate immediate success (exec callback signature: err, stdout, stderr)
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

// Mock path-resolver for binary resolution
const mockResolveBinary = vi.hoisted(() => vi.fn((_name: string): string | null => "/usr/bin/claude"));
const mockGetEnrichedPath = vi.hoisted(() => vi.fn(() => "/usr/bin:/usr/local/bin"));
const mockCaptureUserShellPath = vi.hoisted(() => vi.fn(() => "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"));
const mockCaptureUserShellEnv = vi.hoisted(() => vi.fn((): Record<string, string> => ({})));
vi.mock("./path-resolver.js", () => ({
  resolveBinary: mockResolveBinary,
  getEnrichedPath: mockGetEnrichedPath,
  captureUserShellPath: mockCaptureUserShellPath,
  captureUserShellEnv: mockCaptureUserShellEnv,
}));

// Mock container-manager for container validation in relaunch
const mockIsContainerAlive = vi.hoisted(() => vi.fn((): "running" | "stopped" | "missing" => "running"));
const mockHasBinaryInContainer = vi.hoisted(() => vi.fn((): boolean => true));
const mockStartContainer = vi.hoisted(() => vi.fn());
vi.mock("./container-manager.js", () => ({
  containerManager: {
    isContainerAlive: mockIsContainerAlive,
    hasBinaryInContainer: mockHasBinaryInContainer,
    startContainer: mockStartContainer,
  },
}));

// Mock fs operations for worktree guardrails (CLAUDE.md in .claude dirs)
const mockMkdirSync = vi.hoisted(() => vi.fn());
const mockExistsSync = vi.hoisted(() => vi.fn((..._args: any[]) => false));
const mockReadFileSync = vi.hoisted(() => vi.fn((..._args: any[]) => ""));
const mockWriteFileSync = vi.hoisted(() => vi.fn());
const mockUnlinkSync = vi.hoisted(() => vi.fn());
const mockSymlinkSync = vi.hoisted(() => vi.fn());
const mockLstatSync = vi.hoisted(() =>
  vi.fn((_path?: string): any => {
    throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  }),
);
const isMockedPath = vi.hoisted(() => (path: string): boolean => {
  return (
    path.includes(".claude") ||
    path.includes(".codex") ||
    path.includes(".agents") ||
    path.includes(".companion") ||
    path.startsWith("/tmp/worktrees/") ||
    path.startsWith("/tmp/main-repo")
  );
});

// Async mock functions for node:fs/promises — delegate to sync mocks so test
// setups (mockExistsSync.mockImplementation, mockReadFileSync.mockImplementation, etc.)
// and assertions (expect(mockSymlinkSync).toHaveBeenCalledWith, etc.) still work.
const mockMkdir = vi.hoisted(() =>
  vi.fn(async (...args: any[]) => {
    mockMkdirSync(...args);
  }),
);
const mockAccess = vi.hoisted(() =>
  vi.fn(async (...args: any[]) => {
    if (!mockExistsSync(args[0])) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  }),
);
const mockReadFile = vi.hoisted(() => vi.fn(async (...args: any[]) => mockReadFileSync(...args)));
const mockCopyFile = vi.hoisted(() =>
  vi.fn(async (...args: any[]) => {
    // no-op for mocked paths
  }),
);
const mockCp = vi.hoisted(() =>
  vi.fn(async (..._args: any[]) => {
    // no-op for mocked paths
  }),
);
const mockRm = vi.hoisted(() =>
  vi.fn(async (..._args: any[]) => {
    // no-op for mocked paths
  }),
);
const mockReaddir = vi.hoisted(() => vi.fn(async (..._args: any[]): Promise<any[]> => []));
const mockStat = vi.hoisted(() =>
  vi.fn(async (..._args: any[]) => ({
    isFile: () => true,
    mtimeMs: 1,
  })),
);
const mockRealpath = vi.hoisted(() => vi.fn(async (...args: any[]) => args[0]));
const mockWriteFile = vi.hoisted(() =>
  vi.fn(async (...args: any[]) => {
    mockWriteFileSync(...args);
  }),
);
const mockUnlink = vi.hoisted(() =>
  vi.fn(async (...args: any[]) => {
    mockUnlinkSync(...args);
  }),
);
const mockSymlink = vi.hoisted(() =>
  vi.fn(async (...args: any[]) => {
    mockSymlinkSync(...args);
  }),
);
const mockLstat = vi.hoisted(() => vi.fn(async (...args: any[]) => mockLstatSync(...args)));

vi.mock("node:fs", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    mkdirSync: (...args: any[]) => {
      if (typeof args[0] === "string" && isMockedPath(args[0])) {
        return mockMkdirSync(...args);
      }
      return actual.mkdirSync(...args);
    },
    existsSync: (...args: any[]) => {
      if (typeof args[0] === "string" && isMockedPath(args[0])) {
        return mockExistsSync(...args);
      }
      return actual.existsSync(...args);
    },
    readFileSync: (...args: any[]) => {
      if (typeof args[0] === "string" && isMockedPath(args[0])) {
        return mockReadFileSync(...args);
      }
      return actual.readFileSync(...args);
    },
    writeFileSync: (...args: any[]) => {
      if (typeof args[0] === "string" && isMockedPath(args[0])) {
        return mockWriteFileSync(...args);
      }
      return actual.writeFileSync(...args);
    },
    unlinkSync: (...args: any[]) => {
      if (typeof args[0] === "string" && isMockedPath(args[0])) {
        return mockUnlinkSync(...args);
      }
      return actual.unlinkSync(...args);
    },
    symlinkSync: (...args: any[]) => {
      if (typeof args[0] === "string" && isMockedPath(args[0])) {
        return mockSymlinkSync(...args);
      }
      return actual.symlinkSync(...args);
    },
    lstatSync: (...args: any[]) => {
      if (typeof args[0] === "string" && isMockedPath(args[0])) {
        return mockLstatSync(...args);
      }
      return actual.lstatSync(...args);
    },
  };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    mkdir: async (...args: any[]) => {
      if (typeof args[0] === "string" && isMockedPath(args[0])) {
        return mockMkdir(...args);
      }
      return actual.mkdir(...args);
    },
    access: async (...args: any[]) => {
      if (typeof args[0] === "string" && isMockedPath(args[0])) {
        return mockAccess(...args);
      }
      return actual.access(...args);
    },
    readFile: async (...args: any[]) => {
      if (typeof args[0] === "string" && isMockedPath(args[0])) {
        return mockReadFile(...args);
      }
      return actual.readFile(...args);
    },
    copyFile: async (...args: any[]) => {
      if (
        (typeof args[0] === "string" && isMockedPath(args[0])) ||
        (typeof args[1] === "string" && isMockedPath(args[1]))
      ) {
        return mockCopyFile(...args);
      }
      return actual.copyFile(...args);
    },
    cp: async (...args: any[]) => {
      if (
        (typeof args[0] === "string" && isMockedPath(args[0])) ||
        (typeof args[1] === "string" && isMockedPath(args[1]))
      ) {
        return mockCp(...args);
      }
      return actual.cp(...args);
    },
    rm: async (...args: any[]) => {
      if (typeof args[0] === "string" && isMockedPath(args[0])) {
        return mockRm(...args);
      }
      return actual.rm(...args);
    },
    readdir: async (...args: any[]) => {
      if (typeof args[0] === "string" && isMockedPath(args[0])) {
        return mockReaddir(...args);
      }
      return actual.readdir(...args);
    },
    stat: async (...args: any[]) => {
      if (typeof args[0] === "string" && isMockedPath(args[0])) {
        return mockStat(...args);
      }
      return actual.stat(...args);
    },
    writeFile: async (...args: any[]) => {
      if (typeof args[0] === "string" && isMockedPath(args[0])) {
        return mockWriteFile(...args);
      }
      return actual.writeFile(...args);
    },
    unlink: async (...args: any[]) => {
      if (typeof args[0] === "string" && isMockedPath(args[0])) {
        return mockUnlink(...args);
      }
      return actual.unlink(...args);
    },
    symlink: async (...args: any[]) => {
      // symlink(target, path) — route by target path
      if (typeof args[0] === "string" && isMockedPath(args[0])) {
        return mockSymlink(...args);
      }
      return actual.symlink(...args);
    },
    lstat: async (...args: any[]) => {
      if (typeof args[0] === "string" && isMockedPath(args[0])) {
        return mockLstat(...args);
      }
      return actual.lstat(...args);
    },
    realpath: async (...args: any[]) => {
      if (typeof args[0] === "string" && isMockedPath(args[0])) {
        return mockRealpath(...args);
      }
      return actual.realpath(...args);
    },
  };
});

// ─── Imports (after mocks) ───────────────────────────────────────────────────

import { SessionStore } from "./session-store.js";
import { CliLauncher, type LaunchOptions } from "./cli-launcher.js";

// ─── Bun.spawn mock ─────────────────────────────────────────────────────────

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
    stdout: new ReadableStream<Uint8Array>(),
    stderr: new ReadableStream<Uint8Array>(),
  };
}

const mockSpawn = vi.fn();
const bunGlobal = globalThis as typeof globalThis & { Bun?: any };
const hadBunGlobal = typeof bunGlobal.Bun !== "undefined";
const originalBunSpawn = hadBunGlobal ? bunGlobal.Bun!.spawn : undefined;
if (hadBunGlobal) {
  // In Bun runtime, globalThis.Bun is non-configurable; patch spawn directly.
  (bunGlobal.Bun as { spawn?: unknown }).spawn = mockSpawn;
} else {
  bunGlobal.Bun = { spawn: mockSpawn };
}

// ─── Test setup ──────────────────────────────────────────────────────────────

let tempDir: string;
let store: SessionStore;
let launcher: CliLauncher;

beforeEach(() => {
  vi.clearAllMocks();
  // Re-apply default: lstatSync throws ENOENT (file doesn't exist), matching real behavior
  mockLstatSync.mockImplementation(() => {
    throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  });
  delete process.env.COMPANION_CONTAINER_SDK_HOST;
  delete process.env.COMPANION_FORCE_BYPASS_IN_CONTAINER;
  tempDir = mkdtempSync(join(tmpdir(), "launcher-test-"));
  store = new SessionStore(tempDir);
  launcher = new CliLauncher(3456, { serverId: "test-server-id" });
  launcher.setStore(store);
  mockSpawn.mockReturnValue(createMockCodexProc());
  mockResolveBinary.mockReturnValue("/usr/bin/claude");
  mockGetEnrichedPath.mockReturnValue("/usr/bin:/usr/local/bin");
  mockCaptureUserShellPath.mockReturnValue("/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin");
  mockCaptureUserShellEnv.mockReturnValue({});
  mockCopyFile.mockReset();
  mockReaddir.mockReset();
  mockStat.mockReset();
  mockReaddir.mockResolvedValue([]);
  mockStat.mockResolvedValue({
    isFile: () => true,
    mtimeMs: 1,
  });
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

describe("Codex session-home launch migration", () => {
  // spawnCodex is async (prepareCodexHome uses async fs), so wait for the
  // actual spawn call instead of a fixed delay to avoid timing flakes.
  const waitForSpawnCalls = async (count: number) => {
    const deadline = Date.now() + 2000;
    while (mockSpawn.mock.calls.length < count) {
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for ${count} spawn calls`);
      }
      await new Promise<void>((r) => setTimeout(r, 10));
    }
  };
  const launchCodex = async (overrides: LaunchOptions = {}, spawnCalls = 1) => {
    const info = await launcher.launch({
      backendType: "codex",
      cwd: "/tmp/project",
      codexSandbox: "workspace-write",
      ...overrides,
    });
    await waitForSpawnCalls(spawnCalls);
    return info;
  };
  const mockExistingPaths = (...paths: string[]) => {
    const existing = new Set(paths);
    mockExistsSync.mockImplementation((path: string) => existing.has(path));
  };
  const mockDirent = (name: string, options: { symlink?: boolean; directory?: boolean } = {}) => ({
    name,
    isSymbolicLink: () => options.symlink ?? false,
    isDirectory: () => options.directory ?? true,
  });

  it("refreshes auth.json from the legacy Codex home even when the session copy already exists", async () => {
    mockResolveBinary.mockReturnValue("/opt/fake/codex");
    mockSpawn.mockReturnValueOnce(createMockCodexProc());

    const legacyHome = join(homedir(), ".codex");
    const sessionHome = join(homedir(), ".companion", "codex-home", "test-session-id");
    const legacyAuth = join(legacyHome, "auth.json");
    const sessionAuth = join(sessionHome, "auth.json");

    mockExistingPaths(legacyHome, legacyAuth, sessionAuth);

    await launchCodex();

    expect(mockSymlink).toHaveBeenCalledWith(legacyAuth, sessionAuth);
  });

  it("replaces broken agents skill symlinks before legacy fallback migration", async () => {
    // Legacy migrations can leave broken ~/.agents/skills symlinks. A missing
    // slug fallback must replace those placeholders with usable skill contents.
    mockResolveBinary.mockReturnValue("/opt/fake/codex");
    mockSpawn.mockReturnValueOnce(createMockCodexProc());

    const agentsSkills = join(homedir(), ".agents", "skills");
    const legacyHome = join(homedir(), ".codex");
    const legacySkills = join(legacyHome, "skills");
    const brokenSkill = join(agentsSkills, "cron-scheduling");

    mockExistingPaths(agentsSkills, legacyHome, legacySkills, join(legacySkills, "cron-scheduling"));
    mockReaddir.mockImplementation(async (path: string, options?: { withFileTypes?: boolean }) => {
      if (path === legacySkills && options?.withFileTypes) {
        return [mockDirent("cron-scheduling", { symlink: true, directory: false })];
      }
      if (path === agentsSkills && options?.withFileTypes) {
        return [mockDirent("cron-scheduling", { symlink: true, directory: false })];
      }
      return [];
    });
    mockLstatSync.mockImplementation((path?: string) => {
      if (path === brokenSkill) {
        return {
          isSymbolicLink: () => true,
          isDirectory: () => false,
        };
      }
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });

    await launchCodex();

    expect(mockCp).toHaveBeenCalledWith(join(legacySkills, "cron-scheduling"), brokenSkill, { recursive: true });
    expect(mockUnlink).toHaveBeenCalledWith(brokenSkill);
  });

  it("skips broken legacy Codex skill symlinks during fallback migration", async () => {
    mockResolveBinary.mockReturnValue("/opt/fake/codex");
    mockSpawn.mockReturnValueOnce(createMockCodexProc());

    const agentsSkills = join(homedir(), ".agents", "skills");
    const legacyHome = join(homedir(), ".codex");
    const legacySkills = join(legacyHome, "skills");
    const brokenSource = join(legacySkills, "missing-skill");

    mockExistingPaths(agentsSkills, legacyHome, legacySkills);
    mockReaddir.mockImplementation(async (path: string, options?: { withFileTypes?: boolean }) => {
      if (path === legacySkills && options?.withFileTypes) {
        return [mockDirent("missing-skill", { symlink: true, directory: false })];
      }
      return [];
    });
    mockLstatSync.mockImplementation((path?: string) => {
      if (path === brokenSource) {
        return {
          isSymbolicLink: () => true,
          isDirectory: () => false,
        };
      }
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });

    await launchCodex();

    expect(mockCp).not.toHaveBeenCalledWith(brokenSource, join(agentsSkills, "missing-skill"), { recursive: true });
  });

  it("removes deprecated session Codex skill directories on relaunch", async () => {
    // CODEX_HOME/skills used to be populated as a custom skill root. New
    // launches remove it so official ~/.agents/skills remains the active path.
    mockResolveBinary.mockReturnValue("/opt/fake/codex");
    mockSpawn.mockReturnValueOnce(createMockCodexProc());

    const legacyHome = join(homedir(), ".codex");
    const sessionHome = join(homedir(), ".companion", "codex-home", "test-session-id");
    const sessionSkills = join(sessionHome, "skills");

    mockExistingPaths(legacyHome, sessionSkills);

    await launchCodex();

    expect(mockRm).toHaveBeenCalledWith(sessionSkills, { recursive: true, force: true });
    expect(mockCp).not.toHaveBeenCalledWith(join(legacyHome, "skills"), sessionSkills, { recursive: true });
  });

  it("seeds the matching Codex rollout file into the session home for external resume", async () => {
    mockResolveBinary.mockReturnValue("/opt/fake/codex");
    mockSpawn.mockReturnValueOnce(createMockCodexProc());

    const legacyHome = join(homedir(), ".codex");
    const sessionsRoot = join(legacyHome, "sessions");
    const yearPath = join(sessionsRoot, "2026");
    const monthPath = join(yearPath, "04");
    const dayPath = join(monthPath, "01");
    const rolloutName = "rollout-2026-04-01T00-42-45-thread-abc.jsonl";
    const rolloutPath = join(dayPath, rolloutName);
    const sessionHome = join(homedir(), ".companion", "codex-home", "test-session-id");
    const seededRollout = join(sessionHome, "sessions", "2026", "04", "01", rolloutName);

    mockExistsSync.mockImplementation((path: string) => {
      if (path === legacyHome) return true;
      return false;
    });
    mockReaddir.mockImplementation(async (path: string): Promise<any> => {
      if (path === sessionsRoot) return ["2026"];
      if (path === yearPath) return ["04"];
      if (path === monthPath) return ["01"];
      if (path === dayPath) return [rolloutName];
      return [];
    });
    mockStat.mockImplementation(async (path: string) => {
      if (path === rolloutPath) {
        return {
          isFile: () => true,
          mtimeMs: 42,
        };
      }
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });

    await launchCodex({ resumeCliSessionId: "thread-abc" });

    expect(mockCopyFile).toHaveBeenCalledWith(rolloutPath, seededRollout);
  });
});
