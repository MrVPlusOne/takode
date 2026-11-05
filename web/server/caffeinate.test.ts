import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { spawn } from "node:child_process";

// Never run the real caffeinate.
vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

const { Caffeinate } = await import("./caffeinate.js");

function mockProc() {
  return { on: vi.fn(), kill: vi.fn(), unref: vi.fn(), exitCode: null, signalCode: null };
}

// Caffeinate keeps a Mac awake for a countdown that each call restarts; the server uses it for
// its own machine and `takode node` for the machine it runs on.
describe("Caffeinate", () => {
  const originalPlatform = process.platform;
  const spawnMock = spawn as unknown as ReturnType<typeof vi.fn>;
  const setPlatform = (platform: string) =>
    Object.defineProperty(process, "platform", { value: platform, configurable: true });

  beforeEach(() => {
    vi.useFakeTimers();
    spawnMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    setPlatform(originalPlatform);
  });

  it("does nothing on other platforms", () => {
    setPlatform("linux");
    const caffeinate = new Caffeinate();
    caffeinate.keepAwakeFor(300);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("runs caffeinate -t for the given seconds and restarts the countdown on the next call", () => {
    setPlatform("darwin");
    const first = mockProc();
    const second = mockProc();
    spawnMock.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const caffeinate = new Caffeinate();

    caffeinate.keepAwakeFor(600);
    expect(spawnMock).toHaveBeenCalledWith("caffeinate", ["-t", "600"], expect.anything());
    expect(first.unref).toHaveBeenCalled();

    caffeinate.keepAwakeFor(600);
    expect(first.kill).toHaveBeenCalledWith("SIGTERM");
    expect(spawnMock).toHaveBeenCalledTimes(2);

    caffeinate.stop();
    expect(second.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("logs a failed spawn instead of throwing", () => {
    setPlatform("darwin");
    spawnMock.mockImplementation(() => {
      throw new Error("spawn ENOENT");
    });
    const log = vi.fn();
    new Caffeinate(log).keepAwakeFor(60);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("caffeinate spawn error"));
  });
});
