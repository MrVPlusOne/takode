import { Hono, type Context } from "hono";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { _flushForTest, _resetForTest, getSettings } from "../settings-manager.js";
import { createSettingsRoutes } from "./settings.js";
import { DEFAULT_SESSION_DEFAULTS } from "../../shared/session-defaults.js";
import { SHORTCUT_ACTION_IDS } from "../../shared/shortcut-settings.js";
import { _resetCodexModelCatalogCacheForTest, loadCodexModelCatalog } from "../codex-model-catalog.js";

let tempDir: string;
const mockBroadcastGlobal = vi.fn();

// Stands in for the real session-token check: only requests carrying the agent token count as agents.
function fakeTakodeAuth(c: Context) {
  return c.req.header("x-companion-auth-token") === "agent-token"
    ? { callerId: "agent-session", caller: {} }
    : { response: c.json({ error: "Missing Takode auth headers" }, 403) };
}

function createApp(): Hono {
  const app = new Hono();
  app.route(
    "/api",
    createSettingsRoutes({
      authenticateTakodeCaller: fakeTakodeAuth,
      launcher: {
        listSessions: vi.fn(() => []),
        setServerSlug: vi.fn(),
      },
      wsBridge: { broadcastGlobal: mockBroadcastGlobal },
      sessionStore: { directory: tempDir },
      options: {},
      pushoverNotifier: undefined,
    } as any),
  );
  return app;
}

beforeEach(async () => {
  mockBroadcastGlobal.mockReset();
  _resetCodexModelCatalogCacheForTest();
  tempDir = await mkdtemp(join(tmpdir(), "settings-route-test-"));
  _resetForTest(join(tempDir, "settings.json"));
});

afterEach(async () => {
  await _flushForTest();
  await rm(tempDir, { recursive: true, force: true });
  _resetForTest();
  _resetCodexModelCatalogCacheForTest();
});

describe("settings routes", () => {
  it("accepts shortcut-only settings updates", async () => {
    // Type-to-compose is saved off and Open in Side Column on Alt-click here, so the round trip
    // also proves the server keeps both choices.
    const app = createApp();
    const shortcutSettings = {
      enabled: true,
      preset: "standard",
      overrides: { search_session: "Ctrl+Shift+F" },
      typeToCompose: false,
      openInSideModifier: "alt",
    };

    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shortcutSettings }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.shortcutSettings).toEqual(shortcutSettings);
    expect(getSettings().shortcutSettings).toEqual(shortcutSettings);
  });

  it("keeps an override for every shortcut action the Settings page offers", async () => {
    // Regression: the server once had its own action list without the next-attention action,
    // so it dropped that row's overrides and every recording silently reverted.
    const app = createApp();
    const overrides: Record<string, string | null> = Object.fromEntries(
      SHORTCUT_ACTION_IDS.map((actionId) => [actionId, null]),
    );
    overrides.next_attention = "Cmd+N";
    const shortcutSettings = {
      enabled: true,
      preset: "standard",
      overrides,
      typeToCompose: true,
      openInSideModifier: "shift",
    };

    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shortcutSettings }),
    });

    expect(res.status).toBe(200);
    expect((await res.json()).shortcutSettings).toEqual(shortcutSettings);
    expect(getSettings().shortcutSettings).toEqual(shortcutSettings);
  });

  it("accepts a valid send key scheme and rejects unknown schemes", async () => {
    // The scheme is a fixed enum; unknown values must not silently persist.
    const app = createApp();
    const put = (sendKeyScheme: unknown) =>
      app.request("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sendKeyScheme }),
      });

    const ok = await put("mod-enter");
    expect(ok.status).toBe(200);
    expect((await ok.json()).sendKeyScheme).toBe("mod-enter");
    expect(getSettings().sendKeyScheme).toBe("mod-enter");

    const bad = await put("ctrl-enter");
    expect(bad.status).toBe(400);
    expect(getSettings().sendKeyScheme).toBe("mod-enter");
  });

  it("keeps one sidebar view for every browser and rejects unknown views", async () => {
    // The Spaces/Recent choice is a single server-side setting, so every browser reads the same view.
    const app = createApp();
    const put = (sidebarViewMode: unknown) =>
      app.request("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sidebarViewMode }),
      });

    expect((await (await app.request("/api/settings")).json()).sidebarViewMode).toBe("spaces");
    const ok = await put("recent");
    expect(ok.status).toBe(200);
    expect((await ok.json()).sidebarViewMode).toBe("recent");
    expect(getSettings().sidebarViewMode).toBe("recent");

    const bad = await put("grid");
    expect(bad.status).toBe(400);
    expect(getSettings().sidebarViewMode).toBe("recent");

    // Topics mode lists the leaders' topics instead of their sessions.
    expect((await (await put("topics")).json()).sidebarViewMode).toBe("topics");
    expect(getSettings().sidebarViewMode).toBe("topics");
  });

  it("accepts centralized session defaults settings updates", async () => {
    const app = createApp();
    const sessionDefaults = {
      ...DEFAULT_SESSION_DEFAULTS,
      codex: {
        ...DEFAULT_SESSION_DEFAULTS.codex,
        model: "gpt-5.4",
        serviceTier: "priority",
        reasoningEffort: "ultra",
        internetAccess: true,
        maxContextLength: 240_000,
      },
      claude: {
        ...DEFAULT_SESSION_DEFAULTS.claude,
        model: "claude-sonnet-4-5-20250929",
        permissionMode: "acceptEdits",
        reasoningEffort: "max",
        maxContextLength: 1_000_000,
      },
    };

    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionDefaults }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessionDefaults).toEqual(sessionDefaults);
    expect(getSettings().sessionDefaults).toEqual(sessionDefaults);
    expect(mockBroadcastGlobal).toHaveBeenCalledWith({ type: "settings_updated", sessionDefaults });
  });

  it("rejects unsupported effective Worker Default model-effort pairs", async () => {
    // Settings can retain independent leader values while sharing, but every
    // effective role profile must be launchable according to the installed catalog.
    await loadCodexModelCatalog({
      codexBinary: "/fake/codex",
      statImpl: (async () => ({ mtimeMs: 1, size: 1 })) as never,
      runCodexCommand: async (_binary, args) => ({
        stdout:
          args[0] === "--version"
            ? "codex-cli test"
            : JSON.stringify({
                models: [
                  {
                    slug: "gpt-limited",
                    display_name: "GPT Limited",
                    visibility: "list",
                    supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }],
                  },
                ],
              }),
      }),
    });
    const app = createApp();
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionDefaults: {
          ...DEFAULT_SESSION_DEFAULTS,
          codex: { ...DEFAULT_SESSION_DEFAULTS.codex, model: "gpt-limited", reasoningEffort: "ultra" },
        },
      }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining('Worker Defaults: Codex reasoning effort "ultra" is not supported'),
    });
    expect(mockBroadcastGlobal).not.toHaveBeenCalled();
  });

  it("rejects unsupported Claude max context defaults", async () => {
    const app = createApp();
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionDefaults: {
          claude: { ...DEFAULT_SESSION_DEFAULTS.claude, maxContextLength: 200_000 },
        },
      }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "sessionDefaults.claude.maxContextLength currently supports only 1000000 or empty",
    });
  });

  it("rejects unsupported independent leader Claude max context defaults", async () => {
    const app = createApp();
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionDefaults: {
          ...DEFAULT_SESSION_DEFAULTS,
          leaderUsesWorkerDefaults: false,
          leader: {
            ...DEFAULT_SESSION_DEFAULTS.leader,
            claude: { ...DEFAULT_SESSION_DEFAULTS.leader.claude, maxContextLength: 200_000 },
          },
        },
      }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "sessionDefaults.leader.claude.maxContextLength currently supports only 1000000 or empty",
    });
    expect(mockBroadcastGlobal).not.toHaveBeenCalled();
  });
});

describe("OpenAI test key for agents", () => {
  async function putTranscriptionConfig(app: Hono, transcriptionConfig: Record<string, unknown>) {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcriptionConfig }),
    });
    expect(res.status).toBe(200);
    return res.json();
  }

  function getTestKey(app: Hono, headers: Record<string, string> = { "x-companion-auth-token": "agent-token" }) {
    return app.request("/api/settings/openai-test-key", { headers });
  }

  it("keeps the test key separate from the live key and masks it for browsers", async () => {
    // The live server's key and the agents' test key are stored independently;
    // browsers only ever see "***" for either.
    const app = createApp();
    const saved = await putTranscriptionConfig(app, { apiKey: "live-key", testApiKey: "test-key" });
    expect(saved.transcriptionConfig.apiKey).toBe("***");
    expect(saved.transcriptionConfig.testApiKey).toBe("***");
    expect(getSettings().transcriptionConfig.apiKey).toBe("live-key");
    expect(getSettings().transcriptionConfig.testApiKey).toBe("test-key");

    // Saving the masked form back (the Settings page does this) keeps both keys.
    await putTranscriptionConfig(app, { apiKey: "***", testApiKey: "***", enhancementModel: "gpt-5-mini" });
    expect(getSettings().transcriptionConfig.apiKey).toBe("live-key");
    expect(getSettings().transcriptionConfig.testApiKey).toBe("test-key");
  });

  it("hands the test key only to agent sessions, never the live key", async () => {
    const app = createApp();
    await putTranscriptionConfig(app, { apiKey: "live-key", testApiKey: "test-key" });

    const agent = await getTestKey(app);
    expect(agent.status).toBe(200);
    expect(await agent.json()).toEqual({ apiKey: "test-key", baseUrl: "https://api.openai.com/v1" });

    const browser = await getTestKey(app, {});
    expect(browser.status).toBe(403);
  });

  it("reports no test key instead of falling back to the live key, and clearing removes it", async () => {
    const app = createApp();
    await putTranscriptionConfig(app, { apiKey: "live-key" });
    expect(await (await getTestKey(app)).json()).toEqual({ apiKey: null, baseUrl: "https://api.openai.com/v1" });

    await putTranscriptionConfig(app, { testApiKey: "test-key" });
    await putTranscriptionConfig(app, { testApiKey: "" });
    expect(getSettings().transcriptionConfig.testApiKey).toBeUndefined();
    expect(getSettings().transcriptionConfig.apiKey).toBe("live-key");
  });
});
