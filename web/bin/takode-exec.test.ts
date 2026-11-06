import { parseExecRun, parseMemorySize } from "./takode-exec.js";

/**
 * `takode exec` options end at `--` (or the first word that is not an
 * option); everything after is the remote command, passed on untouched, so its
 * own flags never reach takode.
 */
describe("parseExecRun", () => {
  it("separates takode's options from the remote command", () => {
    expect(parseExecRun(["--host", "condor", "--cwd", "~/repo", "--background", "--", "sbatch", "--help"])).toEqual({
      host: "condor",
      cwd: "~/repo",
      background: true,
      json: false,
      command: "sbatch --help",
    });
  });

  it("takes the command without -- when it follows the options", () => {
    expect(parseExecRun(["--host", "condor", "--json", "squeue -u $USER"])).toMatchObject({
      host: "condor",
      json: true,
      command: "squeue -u $USER",
    });
  });
});

/** `--memory-limit` takes a size with a binary unit; a bare number is refused, so `64` cannot mean 64 bytes. */
describe("--memory-limit", () => {
  it("is passed on in bytes", () => {
    expect(parseExecRun(["--host", "condor", "--memory-limit", "64G", "--", "make"])).toMatchObject({
      memoryLimitBytes: 64 * 2 ** 30,
      command: "make",
    });
  });

  it("reads the usual ways of writing a size", () => {
    expect(parseMemorySize("512M")).toBe(512 * 2 ** 20);
    expect(parseMemorySize("1.5t")).toBe(1.5 * 2 ** 40);
    expect(parseMemorySize("64GiB")).toBe(64 * 2 ** 30);
    expect(parseMemorySize("8GB")).toBe(8 * 2 ** 30);
  });

  it("refuses a size without a unit", () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => parseMemorySize("64")).toThrow("exit");
      expect(error.mock.calls[0]![0]).toContain("needs a size with a unit");
    } finally {
      exit.mockRestore();
      error.mockRestore();
    }
  });
});
