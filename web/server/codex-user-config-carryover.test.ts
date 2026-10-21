import { chmod, lstat, mkdir, mkdtemp, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  _resetCodexProviderEnvCacheForTest,
  captureCodexProviderEnv,
  linkCodexUserHomeEntries,
  readCodexUserConfigSources,
  readUserCodexDeveloperInstructions,
  refreshCodexSessionConfig,
  withUserCodexDeveloperInstructions,
} from "./codex-user-config-carryover.js";

const tempRoots: string[] = [];
async function makeTempDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "takode-codex-carryover-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  _resetCodexProviderEnvCacheForTest();
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
  tempRoots.length = 0;
});

describe("refreshCodexSessionConfig", () => {
  const parse = (toml: string) => Bun.TOML.parse(toml) as Record<string, any>;

  // The user's own config is the source at every launch, so edits made in
  // ~/.codex after a session was created reach its next launch.
  it("takes the user's current settings for everything the session did not change", () => {
    const baseline = 'model = "gpt-old"\n\n[mcp_servers.docs]\ncommand = "docs-old"\n';
    const session = baseline;
    const user =
      'model = "gpt-new"\n\n[mcp_servers.docs]\ncommand = "docs-new"\n\n[mcp_servers.search]\ncommand = "s"\n';

    const refreshed = parse(refreshCodexSessionConfig({ session, user, baseline }));

    expect(refreshed.model).toBe("gpt-new");
    expect(refreshed.mcp_servers).toEqual({ docs: { command: "docs-new" }, search: { command: "s" } });
  });

  // An MCP server toggled in Takode is written into the session's config;
  // that per-session choice must survive the refresh, as must removals.
  it("keeps tables the session changed or removed since Takode last wrote the file", () => {
    const baseline = [
      'model = "gpt-6"',
      "",
      "[mcp_servers.docs]",
      'command = "docs"',
      "",
      "[mcp_servers.search]",
      'command = "s"',
      "",
    ].join("\n");
    const session = [
      'model = "gpt-6"',
      "",
      "[mcp_servers.docs]",
      'command = "docs"',
      "enabled = false",
      "",
      "[mcp_servers.added]",
      'command = "a"',
      "",
    ].join("\n");
    const user = baseline;

    const refreshed = parse(refreshCodexSessionConfig({ session, user, baseline }));

    expect(refreshed.mcp_servers).toEqual({ docs: { command: "docs", enabled: false }, added: { command: "a" } });
  });

  // Takode re-applies its own keys after the refresh; unchanged copies of them
  // from the last launch must not linger once Takode no longer wants them.
  it("drops unchanged session-only keys from Takode's last write", () => {
    const baseline =
      'model = "gpt-6"\nmodel_catalog_json = "/s/takode-model-catalog.json"\n\n[mcp_servers.takode_delegate]\ncommand = "d"\n';

    const refreshed = parse(refreshCodexSessionConfig({ session: baseline, user: 'model = "gpt-6"\n', baseline }));

    expect(refreshed).toEqual({ model: "gpt-6" });
  });

  // Homes from before the refresh have no record of Takode's last write, so
  // nothing tells the session's own edits apart: they keep their config once.
  it("keeps a session config without a baseline unchanged", () => {
    const session = 'model = "gpt-old"\n\n[mcp_servers.added]\ncommand = "a"\n';

    expect(refreshCodexSessionConfig({ session, user: 'model = "gpt-new"\n' })).toBe(session);
  });

  it("builds a new session's config from the user's config", () => {
    expect(parse(refreshCodexSessionConfig({ user: 'model = "gpt-new"\n' }))).toEqual({ model: "gpt-new" });
  });

  // Codex rewrites config.toml through its own TOML writer (for example when
  // Takode sets developer_instructions); a reformatted table is not an edit.
  it("does not treat reformatting as a session edit, and handles multi-line values", () => {
    const baseline = [
      'notes = """',
      "[not a table]",
      '"""',
      "args = [",
      '  "a",',
      "]",
      "",
      "[profile]",
      'name = "x"',
      "",
    ].join("\n");
    const session = baseline.replace('name = "x"', "name   =   'x'  # same value");
    const user = baseline.replace('name = "x"', 'name = "y"');

    const refreshedText = refreshCodexSessionConfig({ session, user, baseline });
    const refreshed = parse(refreshedText);

    // The session's reformatted [profile] is unchanged in meaning, so the user's edit wins.
    expect(refreshed).toEqual(parse(user));
    expect(refreshed.profile).toEqual({ name: "y" });
    expect(refreshed.args).toEqual(["a"]);
  });

  it("puts top-level keys the session added before every table", () => {
    const session = 'model = "gpt-6"\nsession_key = 1\n\n[tools]\nx = 1\n';
    const refreshed = refreshCodexSessionConfig({ session, user: "[tools]\nx = 1\n", baseline: "" });

    expect(parse(refreshed)).toEqual({ session_key: 1, model: "gpt-6", tools: { x: 1 } });
  });
});

describe("readCodexUserConfigSources", () => {
  // Codex keys hook approvals by the declaring file's path; without moving them
  // to the session's paths, hooks the user approved would not run in Takode.
  it("moves hook approvals from the user's files to the session's", async () => {
    const userHome = await makeTempDir();
    const sessionHome = await makeTempDir();
    const hooksKey = `${join(userHome, "hooks.json")}:pre_tool_use:0:0`;
    const configKey = `${join(userHome, "config.toml")}:stop:0:0`;
    await writeFile(
      join(userHome, "config.toml"),
      `[hooks.state."${hooksKey}"]\ntrusted_hash = "a"\n\n[hooks.state."${configKey}"]\ntrusted_hash = "b"\n`,
    );

    const sources = await readCodexUserConfigSources(sessionHome, userHome);

    const state = (Bun.TOML.parse(sources!.user) as any).hooks.state;
    expect(Object.keys(state).sort()).toEqual(
      [`${join(sessionHome, "hooks.json")}:pre_tool_use:0:0`, `${join(sessionHome, "config.toml")}:stop:0:0`].sort(),
    );
  });

  it("does nothing when the session home is the user's own", async () => {
    const home = await makeTempDir();
    expect(await readCodexUserConfigSources(home, home)).toBeUndefined();
  });
});

describe("linkCodexUserHomeEntries", () => {
  it("links the user's plugins and hooks, and drops links whose source is gone", async () => {
    const userHome = await makeTempDir();
    const sessionHome = await makeTempDir();
    await mkdir(join(userHome, "plugins", "cache"), { recursive: true });
    await writeFile(join(userHome, "hooks.json"), "{}");

    await linkCodexUserHomeEntries(sessionHome, userHome);
    expect(await readlink(join(sessionHome, "plugins"))).toBe(join(userHome, "plugins"));
    expect(await readlink(join(sessionHome, "hooks.json"))).toBe(join(userHome, "hooks.json"));

    await rm(join(userHome, "hooks.json"));
    await linkCodexUserHomeEntries(sessionHome, userHome);
    await expect(lstat(join(sessionHome, "hooks.json"))).rejects.toThrow();
    expect(await readlink(join(sessionHome, "plugins"))).toBe(join(userHome, "plugins"));
  });

  it("leaves a plugins folder the session made itself", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const userHome = await makeTempDir();
    const sessionHome = await makeTempDir();
    await mkdir(join(userHome, "plugins"));
    await mkdir(join(sessionHome, "plugins"));

    await linkCodexUserHomeEntries(sessionHome, userHome);

    expect((await lstat(join(sessionHome, "plugins"))).isDirectory()).toBe(true);
    warn.mockRestore();
  });
});

describe("user developer instructions", () => {
  it("reads multi-line developer_instructions and adds them as a labelled section", () => {
    const user = 'model = "gpt-6"\ndeveloper_instructions = """\nAlways run the linter.\n"""\n';
    const instructions = readUserCodexDeveloperInstructions(user);

    expect(instructions).toBe("Always run the linter.");
    const combined = withUserCodexDeveloperInstructions("Takode rules", instructions);
    expect(combined?.startsWith("Takode rules\n\n## The user's own Codex developer instructions")).toBe(true);
    expect(combined?.endsWith("Always run the linter.")).toBe(true);
    expect(withUserCodexDeveloperInstructions("Takode rules", undefined)).toBe("Takode rules");
    expect(readUserCodexDeveloperInstructions('model = "gpt-6"\n')).toBeUndefined();
  });
});

describe("captureCodexProviderEnv", () => {
  // A server started outside the user's shell lacks variables their profile
  // sets; the provider key is then read from a login shell, once.
  it("prefers the server's environment and reads missing keys once from a login shell", async () => {
    const dir = await makeTempDir();
    const shell = join(dir, "fake-shell");
    const counter = join(dir, "runs");
    await writeFile(
      shell,
      `#!/bin/sh\necho run >> "${counter}"\necho "noise"\necho "___ENV_TEST_PROVIDER_KEY___=from-shell"\n`,
    );
    await chmod(shell, 0o755);
    vi.stubEnv("SHELL", shell);
    vi.stubEnv("TEST_SERVER_KEY", "from-server");
    vi.stubEnv("TEST_PROVIDER_KEY", "");

    expect(await captureCodexProviderEnv(["TEST_SERVER_KEY", "TEST_PROVIDER_KEY", "bad name"])).toEqual({
      TEST_SERVER_KEY: "from-server",
      TEST_PROVIDER_KEY: "from-shell",
    });
    expect(await captureCodexProviderEnv(["TEST_PROVIDER_KEY"])).toEqual({ TEST_PROVIDER_KEY: "from-shell" });
    expect((await Bun.file(counter).text()).trim().split("\n")).toHaveLength(1);
  });
});
