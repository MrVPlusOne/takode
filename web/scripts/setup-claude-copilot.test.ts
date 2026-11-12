import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const SCRIPT = join(REPO_ROOT, "scripts", "setup-claude-copilot.sh");
const TEMPLATE = join(REPO_ROOT, "scripts", "claude-copilot-settings.json");
const FAKE_TOKEN = "gho_fake_token_must_not_leak";
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

/** Copilot model-list responses the fake `curl` can return; `null` makes the request fail. */
const MODELS_WITH_FABLE = '{"data":[{"id":"claude-opus-5.5"},{"id":"claude-fable-5.2"},{"id":"claude-sonnet-5.5"}]}';
const MODELS_WITHOUT_FABLE = '{"data":[{"id":"claude-opus-5.5"},{"id":"claude-sonnet-5.5"}]}';

/**
 * Builds an isolated HOME plus fake `claude`, `gh` and `curl` binaries so the
 * setup script never touches the real user's files, GitHub account or network.
 * The fake `claude` records the arguments and credential env it was launched
 * with; the fake `curl` records its arguments and standard input, then prints
 * the given Copilot model list.
 */
async function makeFixture(
  options: { claudeVersion?: string; ghSignedIn?: boolean; copilotModels?: string | null } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "claude-copilot-setup-"));
  tempDirs.push(root);
  const home = join(root, "home");
  const bin = join(root, "bin");
  const launchLog = join(root, "launch.log");
  const curlLog = join(root, "curl.log");
  await mkdir(home);
  await mkdir(bin);
  await writeFile(
    join(bin, "claude"),
    [
      "#!/bin/sh",
      `if [ "$1" = "--version" ]; then echo "${options.claudeVersion ?? "2.1.289"} (Claude Code)"; exit 0; fi`,
      `printf 'arg:%s\\n' "$@" > "${launchLog}"`,
      `echo "api-key:\${ANTHROPIC_API_KEY-unset}" >> "${launchLog}"`,
    ].join("\n"),
  );
  await writeFile(
    join(bin, "gh"),
    options.ghSignedIn === false ? "#!/bin/sh\nexit 1\n" : `#!/bin/sh\necho ${FAKE_TOKEN}\n`,
  );
  const copilotModels = options.copilotModels === undefined ? MODELS_WITH_FABLE : options.copilotModels;
  await writeFile(
    join(bin, "curl"),
    [
      "#!/bin/sh",
      `printf 'arg:%s\\n' "$@" > "${curlLog}"`,
      `sed 's/^/stdin:/' >> "${curlLog}"`,
      copilotModels === null ? "exit 7" : `echo '${copilotModels}'`,
    ].join("\n"),
  );
  await chmod(join(bin, "claude"), 0o755);
  await chmod(join(bin, "gh"), 0o755);
  await chmod(join(bin, "curl"), 0o755);
  const installDir = join(home, ".companion", "claude-copilot");
  return {
    bin,
    launchLog,
    curlLog,
    installDir,
    settings: join(installDir, "settings.json"),
    launcher: join(installDir, "claude-copilot"),
    run: () =>
      spawnSync("/bin/bash", [SCRIPT], {
        encoding: "utf8",
        env: { HOME: home, PATH: `${bin}:/usr/bin:/bin` },
      }),
  };
}

describe("setup-claude-copilot.sh", () => {
  it("installs the sample settings with an absolute gh path and a launcher for the existing claude", async () => {
    const fixture = await makeFixture();
    const result = fixture.run();
    expect(result.status, result.stderr).toBe(0);
    // The token is fetched only to confirm sign-in and must never be echoed.
    expect(result.stdout + result.stderr).not.toContain(FAKE_TOKEN);

    // Settings match the tracked sample except for the resolved gh path.
    const expected = JSON.parse(await readFile(TEMPLATE, "utf8"));
    expected.apiKeyHelper = `${fixture.bin}/gh auth token`;
    expect(JSON.parse(await readFile(fixture.settings, "utf8"))).toEqual(expected);
    expect((await stat(fixture.settings)).mode & 0o777).toBe(0o600);
    expect((await stat(fixture.launcher)).mode & 0o777).toBe(0o755);
    expect(result.stdout).toContain(fixture.launcher);

    // The launcher drops conflicting credentials, selects the Copilot settings,
    // and requests partial messages only for streaming output.
    const launch = spawnSync(fixture.launcher, ["--output-format", "stream-json", "-p", "hi"], {
      encoding: "utf8",
      env: { PATH: "/usr/bin:/bin", ANTHROPIC_API_KEY: "conflicting-key" },
    });
    expect(launch.status, launch.stderr).toBe(0);
    expect(await readFile(fixture.launchLog, "utf8")).toBe(
      [
        "arg:--settings",
        `arg:${fixture.settings}`,
        "arg:--include-partial-messages",
        "arg:--output-format",
        "arg:stream-json",
        "arg:-p",
        "arg:hi",
        "api-key:unset",
        "",
      ].join("\n"),
    );

    spawnSync(fixture.launcher, ["--version"], { env: { PATH: "/usr/bin:/bin" } });
    spawnSync(fixture.launcher, ["--output-format", "json"], { env: { PATH: "/usr/bin:/bin" } });
    expect(await readFile(fixture.launchLog, "utf8")).not.toContain("--include-partial-messages");
  });

  it("lists Fable only when the account's Copilot serves the pinned Fable model", async () => {
    // Fable is gated on Copilot; offering it to an account without access would
    // put a model in the menu whose every request fails.
    const template = JSON.parse(await readFile(TEMPLATE, "utf8"));
    const fableModel = template.env.ANTHROPIC_DEFAULT_FABLE_MODEL;
    expect(template.availableModels).toContain("fable");

    const served = await makeFixture({ copilotModels: MODELS_WITH_FABLE });
    const servedRun = served.run();
    expect(servedRun.status, servedRun.stderr).toBe(0);
    expect(JSON.parse(await readFile(served.settings, "utf8")).availableModels).toEqual(template.availableModels);
    expect(servedRun.stdout).toContain("Fable 5.2");
    // The token reaches curl only as a header on standard input, never as an argument.
    const curlLog = await readFile(served.curlLog, "utf8");
    expect(curlLog).toContain(`stdin:Authorization: Bearer ${FAKE_TOKEN}`);
    expect(curlLog.split("\n").filter((line) => line.startsWith("arg:"))).not.toContainEqual(
      expect.stringContaining(FAKE_TOKEN),
    );

    // Not served, or the list can't be read: everything else matches the template, minus Fable.
    for (const [copilotModels, note] of [
      [MODELS_WITHOUT_FABLE, `doesn't offer ${fableModel}`],
      [null, "could not read Copilot's model list"],
    ] as const) {
      const fixture = await makeFixture({ copilotModels });
      const result = fixture.run();
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain(note);
      expect(result.stdout).not.toContain("Fable 5.2");
      expect(JSON.parse(await readFile(fixture.settings, "utf8"))).toEqual({
        ...template,
        apiKeyHelper: `${fixture.bin}/gh auth token`,
        availableModels: template.availableModels.filter((alias: string) => alias !== "fable"),
      });
    }
  });

  it("is idempotent and backs up a file before replacing changed content", async () => {
    const fixture = await makeFixture();
    expect(fixture.run().status).toBe(0);
    const rerun = fixture.run();
    expect(rerun.status).toBe(0);
    expect(rerun.stdout).toContain(`unchanged: ${fixture.settings}`);
    expect((await readdir(fixture.installDir)).filter((name) => name.includes(".bak-"))).toEqual([]);

    // A hand-edited settings file is preserved as a backup, then restored to the sample.
    const installed = await readFile(fixture.settings, "utf8");
    await writeFile(fixture.settings, '{"model":"edited"}\n');
    const repair = fixture.run();
    expect(repair.status).toBe(0);
    const backups = (await readdir(fixture.installDir)).filter((name) => name.startsWith("settings.json.bak-"));
    expect(backups).toHaveLength(1);
    expect(await readFile(join(fixture.installDir, backups[0]), "utf8")).toBe('{"model":"edited"}\n');
    expect(await readFile(fixture.settings, "utf8")).toBe(installed);
  });

  it("refuses a Claude Code release older than the verified minimum without writing files", async () => {
    const fixture = await makeFixture({ claudeVersion: "2.1.118" });
    const result = fixture.run();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("2.1.118 is too old");
    await expect(stat(fixture.installDir)).rejects.toThrow();
  });

  it("accepts newer releases that compare greater only numerically", async () => {
    // 2.1.1000 sorts before 2.1.289 as text; the check must compare numbers.
    const fixture = await makeFixture({ claudeVersion: "2.1.1000" });
    expect(fixture.run().status).toBe(0);
  });

  it("requires a signed-in GitHub CLI", async () => {
    const fixture = await makeFixture({ ghSignedIn: false });
    const result = fixture.run();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("gh auth login");
    await expect(stat(fixture.installDir)).rejects.toThrow();
  });

  it("keeps the guide's sample settings identical to the installed template", async () => {
    // The guide shows the settings inline; drift would document a different setup than the script installs.
    const guide = await readFile(join(REPO_ROOT, "docs", "github-copilot.md"), "utf8");
    const sample = guide.match(/```json\n([\s\S]*?)```/)?.[1];
    expect(JSON.parse(sample ?? "null")).toEqual(JSON.parse(await readFile(TEMPLATE, "utf8")));
  });
});
