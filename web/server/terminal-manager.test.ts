import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TerminalManager } from "./terminal-manager.js";

type SpawnTerminalOptions = Parameters<typeof Bun.spawn>[1];

describe("TerminalManager", () => {
  let spawnOptions: SpawnTerminalOptions | undefined;
  let fakeTerminal: {
    write: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
  let fakeProc: {
    pid: number;
    exitCode: number;
    exited: Promise<number>;
    kill: ReturnType<typeof vi.fn>;
    terminal: typeof fakeTerminal;
  };

  // Real folders: the manager refuses to start a shell in one that does not exist.
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "terminal-manager-"));
    await mkdir(join(root, "a"));
    await mkdir(join(root, "b"));
    fakeTerminal = {
      write: vi.fn(),
      resize: vi.fn(),
      close: vi.fn(),
    };
    fakeProc = {
      pid: 1234,
      exitCode: 0,
      exited: Promise.resolve(0),
      kill: vi.fn(),
      terminal: fakeTerminal,
    };
    spawnOptions = undefined;
    vi.spyOn(Bun, "spawn").mockImplementation(((_cmd: string[], opts?: SpawnTerminalOptions) => {
      spawnOptions = opts;
      return fakeProc as unknown as ReturnType<typeof Bun.spawn>;
    }) as typeof Bun.spawn);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  it("replays buffered output to a socket that attaches after spawn", () => {
    const manager = new TerminalManager();
    const terminalId = manager.spawn("session-a", root);
    const ws = { sendBinary: vi.fn(), send: vi.fn() } as any;

    ((spawnOptions as any)?.terminal?.data as ((terminal: unknown, data: Uint8Array) => void) | undefined)?.(
      fakeTerminal,
      new Uint8Array([36, 32]),
    );
    manager.addBrowserSocket(terminalId, ws);

    expect(ws.sendBinary).toHaveBeenCalledWith(expect.any(Uint8Array));
  });

  it("keeps separate long-lived terminals per session key", () => {
    const manager = new TerminalManager();

    const first = manager.spawn("session-a", join(root, "a"));
    const second = manager.spawn("session-b", join(root, "b"));

    expect(first).not.toBe(second);
    expect(manager.getInfo("session-a")).toEqual({ id: first, cwd: join(root, "a"), hostId: null });
    expect(manager.getInfo("session-b")).toEqual({ id: second, cwd: join(root, "b"), hostId: null });
  });

  // Bun crashes the whole server when a PTY spawn fails, so a missing folder
  // must be refused before any spawn is attempted.
  it("refuses a missing folder without spawning", () => {
    const manager = new TerminalManager();

    expect(() => manager.spawn("session-a", join(root, "missing"))).toThrow(/Cannot open a terminal/);
    expect(Bun.spawn).not.toHaveBeenCalled();
    expect(manager.getInfo("session-a")).toBeNull();
  });
});
