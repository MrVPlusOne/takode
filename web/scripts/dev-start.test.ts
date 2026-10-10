import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const SCRIPT_SOURCE = join(import.meta.dirname, "..", "..", "scripts", "dev-start.sh");
const tempDirs: string[] = [];

describe("scripts/dev-start.sh", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
  });

  it("fails fast with setup guidance when web dependencies are missing", async () => {
    // Fresh clones should stop before any startup work and point to the
    // explicit install command instead of attempting a package install.
    const fixture = await createFixture();

    const result = runDevStart(fixture.rootDir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Missing local web dependencies");
    expect(result.stderr).toContain("bun install --cwd web");
    expect(result.stderr).toContain("make dev");
    expect(result.stderr).toContain("./scripts/dev-start.sh");
  });

  it("fails fast when the install state is incomplete", async () => {
    // Partial node_modules state should produce the same actionable guidance
    // instead of falling through to a noisier Vite or backend startup failure.
    const fixture = await createFixture();
    await mkdir(join(fixture.rootDir, "web", "node_modules"), { recursive: true });

    const result = runDevStart(fixture.rootDir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Expected install artifact not found");
    expect(result.stderr).toContain("node_modules/.bin/vite");
  });

  it("checks ports with ss on machines without lsof", async () => {
    // Minimal Linux hosts have ss but no lsof. PATH holds only the fake tools
    // plus the real basic utilities the script needs, so lsof cannot be found.
    const fixture = await createFixture({ withLsof: false });
    const bin = join(fixture.rootDir, ".fake-bin");
    await writeExecutable(
      join(bin, "ss"),
      [
        "#!/bin/sh",
        'echo "State Recv-Q Send-Q Local Address:Port Peer Address:Port Process"',
        `echo 'LISTEN 0 512 127.0.0.1:3457 0.0.0.0:* users:(("bun",pid=4242,fd=11))'`,
      ].join("\n"),
    );
    await writeExecutable(join(bin, "curl"), '#!/bin/sh\necho "200"\n');
    for (const tool of ["dirname", "tail", "grep", "head", "cut"]) {
      await symlink(realTool(tool), join(bin, tool));
    }

    const result = runDevStart(fixture.rootDir, ["--status"], bin);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Backend running on http://localhost:3457 (PID: 4242)");
  });
});

async function createFixture({ withLsof = true } = {}): Promise<{ rootDir: string }> {
  const rootDir = await mkdtemp(join(tmpdir(), "takode-dev-start-"));
  tempDirs.push(rootDir);

  await mkdir(join(rootDir, "scripts"), { recursive: true });
  await mkdir(join(rootDir, "web"), { recursive: true });
  await mkdir(join(rootDir, ".fake-bin"), { recursive: true });

  await writeFile(join(rootDir, "scripts", "dev-start.sh"), await readFile(SCRIPT_SOURCE, "utf-8"), "utf-8");
  await writeFile(join(rootDir, "web", "package.json"), '{ "name": "fixture-web" }\n', "utf-8");
  await writeExecutable(join(rootDir, ".fake-bin", "bun"), '#!/usr/bin/env bash\necho "1.3.10"\n');
  await writeExecutable(join(rootDir, ".fake-bin", "python3"), "#!/usr/bin/env bash\nexit 0\n");
  if (withLsof) await writeExecutable(join(rootDir, ".fake-bin", "lsof"), "#!/usr/bin/env bash\nexit 1\n");

  return { rootDir };
}

function runDevStart(
  rootDir: string,
  args: string[] = [],
  path = `${join(rootDir, ".fake-bin")}:${process.env.PATH || ""}`,
) {
  return spawnSync(realTool("bash"), [join(rootDir, "scripts", "dev-start.sh"), ...args], {
    cwd: rootDir,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: path,
    },
  });
}

function realTool(name: string): string {
  return spawnSync("sh", ["-c", `command -v ${name}`], { encoding: "utf8" }).stdout.trim();
}

async function writeExecutable(path: string, contents: string): Promise<void> {
  await writeFile(path, contents, { mode: 0o755 });
}
