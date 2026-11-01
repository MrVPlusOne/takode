import { parseExecRun } from "./takode-exec.js";

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
