import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CALLER_CWD_ENV, bunCommandArgs, bunCommandEnv } from "../shared/bun-command-launch.js";
import { buildInstalledCliWrapper } from "../server/cli-wrapper-paths.js";

const CALLER_CWD_MODULE = fileURLToPath(new URL("./caller-cwd.ts", import.meta.url));

async function run(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }) {
  const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += String(chunk)));
  child.stderr.on("data", (chunk) => (stderr += String(chunk)));
  const [code] = await once(child, "close");
  return { code: code as number | null, stdout, stderr };
}

// Takode starts its commands from its own web folder (so Bun does not list the caller's
// parent folders at startup) and bin/caller-cwd.ts switches back before the command runs.
// These tests check that a command still sees the directory it was run from.
describe("Takode command working directory", () => {
  let root: string;
  let caller: string;
  let probe: string;

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), "takode-caller-cwd-")));
    caller = join(root, "caller");
    await mkdir(caller);
    // A stand-in command laid out like web/bin/<command>.ts, importing the real module first.
    await mkdir(join(root, "web", "bin"), { recursive: true });
    probe = join(root, "web", "bin", "probe.ts");
    await writeFile(
      probe,
      `import ${JSON.stringify(CALLER_CWD_MODULE)};\nconsole.log(JSON.stringify({ cwd: process.cwd(), env: process.env.${CALLER_CWD_ENV} ?? null }));\n`,
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("runs a server-started command in the caller's directory and keeps the variable from its children", async () => {
    const result = await run(process.execPath, bunCommandArgs(probe, [], join(root, "web")), {
      cwd: caller,
      env: bunCommandEnv(process.env, caller),
    });
    expect(result.code, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ cwd: caller, env: null });
  });

  it("runs a command started through the generated wrapper in the shell's directory", async () => {
    const wrapper = join(root, "probe-wrapper");
    await writeFile(wrapper, buildInstalledCliWrapper("probe", probe), { mode: 0o755 });
    // A stale PWD, as a parent that is not a shell may pass, must not mislead the wrapper.
    const env = { ...process.env, PWD: "/stale", PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}` };
    const result = await run("bash", [wrapper], { cwd: caller, env });
    expect(result.code, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ cwd: caller, env: null });
  });

  it("stops instead of running from the Takode folder when the caller's directory is gone", async () => {
    // Relative paths and Git commands would otherwise act on the Takode checkout.
    const result = await run(process.execPath, bunCommandArgs(probe, [], join(root, "web")), {
      cwd: caller,
      env: bunCommandEnv(process.env, join(root, "missing")),
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Cannot enter the directory this command was run from");
    expect(result.stdout).toBe("");
  });
});
