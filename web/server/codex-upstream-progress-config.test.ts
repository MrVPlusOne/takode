import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  configureCodexUpstreamProgressProxy,
  ensureCodexUpstreamProgressProxyConfig,
} from "./codex-upstream-progress-config.js";
import type { CodexUpstreamProgressProxyRegistry } from "./codex-upstream-progress-proxy.js";

describe("Codex upstream progress proxy config", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  async function makeCodexHome(config: string): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "takode-codex-progress-config-"));
    tempRoots.push(root);
    await writeFile(join(root, "config.toml"), config, "utf-8");
    return root;
  }

  function fakeRegistry(
    calls: Array<{ sessionId: string; upstreamBaseUrl: string }>,
  ): CodexUpstreamProgressProxyRegistry {
    return {
      registerSessionUpstream(sessionId, upstreamBaseUrl) {
        calls.push({ sessionId, upstreamBaseUrl });
        return "http://127.0.0.1:3456/api/codex-upstream-progress-proxy/test-token/v1";
      },
    };
  }

  it("rewrites only MAI LiteLLM base_url and records the original upstream in a comment marker", async () => {
    const codexHome = await makeCodexHome(
      [
        'model_provider = "mai-litellm"',
        "",
        "[model_providers.mai-litellm]",
        'name = "MAI LiteLLM"',
        'base_url = "https://nbagents.example/v1"',
        'env_key = "LITELLM_API_KEY"',
        "",
      ].join("\n"),
    );
    const calls: Array<{ sessionId: string; upstreamBaseUrl: string }> = [];

    const result = await ensureCodexUpstreamProgressProxyConfig(codexHome, {
      sessionId: "session-1",
      registry: fakeRegistry(calls),
    });

    const config = await readFile(join(codexHome, "config.toml"), "utf-8");
    expect(result).toMatchObject({ enabled: true, changed: true, upstreamBaseUrl: "https://nbagents.example/v1" });
    expect(calls).toEqual([{ sessionId: "session-1", upstreamBaseUrl: "https://nbagents.example/v1" }]);
    expect(config).toContain('# takode-copilot-progress-upstream-base-url = "https://nbagents.example/v1"');
    expect(config).toContain('base_url = "http://127.0.0.1:3456/api/codex-upstream-progress-proxy/test-token/v1"');
    expect(config).toContain('env_key = "LITELLM_API_KEY"');
  });

  it("does not register or rewrite standard OpenAI/Codex providers", async () => {
    const codexHome = await makeCodexHome(
      ['model_provider = "openai"', "", "[model_providers.openai]", 'base_url = "https://api.openai.com/v1"', ""].join(
        "\n",
      ),
    );
    const calls: Array<{ sessionId: string; upstreamBaseUrl: string }> = [];

    const result = await ensureCodexUpstreamProgressProxyConfig(codexHome, {
      sessionId: "session-1",
      registry: fakeRegistry(calls),
    });

    const config = await readFile(join(codexHome, "config.toml"), "utf-8");
    expect(result).toEqual({ enabled: false, changed: false });
    expect(calls).toEqual([]);
    expect(config).toContain('base_url = "https://api.openai.com/v1"');
  });

  it("does not register or rewrite unrelated litellm config providers by default", async () => {
    const codexHome = await makeCodexHome(
      [
        'model_provider = "litellm"',
        "",
        "[model_providers.litellm]",
        'base_url = "https://unrelated-litellm.example/v1"',
        "",
      ].join("\n"),
    );
    const calls: Array<{ sessionId: string; upstreamBaseUrl: string }> = [];

    const result = await ensureCodexUpstreamProgressProxyConfig(codexHome, {
      sessionId: "session-1",
      registry: fakeRegistry(calls),
    });

    const config = await readFile(join(codexHome, "config.toml"), "utf-8");
    expect(result).toEqual({ enabled: false, changed: false });
    expect(calls).toEqual([]);
    expect(config).toContain('base_url = "https://unrelated-litellm.example/v1"');
  });

  it("rewrites nbagents wrapper env for the litellm command-line provider path", async () => {
    const codexHome = await makeCodexHome(
      ['model_provider = "openai"', "", "[model_providers.openai]", 'base_url = "https://api.openai.com/v1"', ""].join(
        "\n",
      ),
    );
    const wrapperRoot = await mkdtemp(join(tmpdir(), "takode-mai-wrapper-"));
    tempRoots.push(wrapperRoot);
    await writeFile(join(wrapperRoot, ".mai-agents-root"), "", "utf-8");
    await writeFile(join(wrapperRoot, "codex.sh"), "#!/usr/bin/env bash\n", "utf-8");
    await mkdir(join(wrapperRoot, ".run"));
    const envPath = join(wrapperRoot, ".run", ".env-companion-codex-home-session-wrapper");
    await writeFile(
      envPath,
      ["LITELLM_API_KEY='not-a-real-key'", "LITELLM_PROXY_URL='https://nbagents.example/v1'", ""].join("\n"),
      "utf-8",
    );
    const calls: Array<{ sessionId: string; upstreamBaseUrl: string }> = [];
    const spawnEnv: Record<string, string | undefined> = { CODEX_HOME: codexHome };

    const result = await configureCodexUpstreamProgressProxy({
      sessionId: "session-wrapper",
      registry: fakeRegistry(calls),
      spawnCmd: [join(wrapperRoot, "codex.sh"), "-c", "model_provider=litellm"],
      spawnEnv,
    });

    const env = await readFile(envPath, "utf-8");
    const config = await readFile(join(codexHome, "config.toml"), "utf-8");
    expect(result).toMatchObject({
      enabled: true,
      changed: true,
      source: "mai-wrapper-env",
      upstreamBaseUrl: "https://nbagents.example/v1",
    });
    expect(calls).toEqual([{ sessionId: "session-wrapper", upstreamBaseUrl: "https://nbagents.example/v1" }]);
    expect(spawnEnv.LITELLM_PROXY_URL).toBe("http://127.0.0.1:3456/api/codex-upstream-progress-proxy/test-token/v1");
    expect(env).toContain('# takode-copilot-progress-upstream-litellm-proxy-url = "https://nbagents.example/v1"');
    expect(env).toContain("LITELLM_PROXY_URL='http://127.0.0.1:3456/api/codex-upstream-progress-proxy/test-token/v1'");
    expect(config).toContain('base_url = "https://api.openai.com/v1"');
  });

  it("does not rewrite codex.sh wrappers without the nbagents marker", async () => {
    const codexHome = await makeCodexHome("");
    const wrapperRoot = await mkdtemp(join(tmpdir(), "takode-unrelated-wrapper-"));
    tempRoots.push(wrapperRoot);
    await writeFile(join(wrapperRoot, "codex.sh"), "#!/usr/bin/env bash\n", "utf-8");
    const calls: Array<{ sessionId: string; upstreamBaseUrl: string }> = [];

    const result = await configureCodexUpstreamProgressProxy({
      sessionId: "session-wrapper",
      registry: fakeRegistry(calls),
      spawnCmd: [join(wrapperRoot, "codex.sh")],
      spawnEnv: { CODEX_HOME: codexHome },
    });

    expect(result).toEqual({ enabled: false, changed: false });
    expect(calls).toEqual([]);
  });

  it("recovers the original upstream from the marker when relaunch sees a prior proxy URL", async () => {
    const codexHome = await makeCodexHome(
      [
        'model_provider = "mai-litellm"',
        "",
        "[model_providers.mai-litellm]",
        '# takode-copilot-progress-upstream-base-url = "https://nbagents.example/v1"',
        'base_url = "http://127.0.0.1:9999/api/codex-upstream-progress-proxy/old-token/v1"',
        "",
      ].join("\n"),
    );
    const calls: Array<{ sessionId: string; upstreamBaseUrl: string }> = [];

    const result = await ensureCodexUpstreamProgressProxyConfig(codexHome, {
      sessionId: "session-2",
      registry: fakeRegistry(calls),
    });

    expect(result.enabled).toBe(true);
    expect(calls).toEqual([{ sessionId: "session-2", upstreamBaseUrl: "https://nbagents.example/v1" }]);
  });
});
