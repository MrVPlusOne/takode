import { Hono } from "hono";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { _flushForTest, _resetForTest, getSettings } from "../settings-manager.js";
import { createSettingsRoutes } from "./settings.js";
import { DEFAULT_SESSION_DEFAULTS } from "../../shared/session-defaults.js";

let tempDir: string;

function createApp(): Hono {
  const app = new Hono();
  app.route(
    "/api",
    createSettingsRoutes({
      launcher: {
        listSessions: vi.fn(() => []),
        setServerSlug: vi.fn(),
      },
      wsBridge: {},
      sessionStore: { directory: tempDir },
      options: {},
      pushoverNotifier: undefined,
    } as any),
  );
  return app;
}

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "settings-route-test-"));
  _resetForTest(join(tempDir, "settings.json"));
});

afterEach(async () => {
  await _flushForTest();
  await rm(tempDir, { recursive: true, force: true });
  _resetForTest();
});

describe("settings routes", () => {
  it("accepts shortcut-only settings updates", async () => {
    const app = createApp();
    const shortcutSettings = {
      enabled: true,
      preset: "standard",
      overrides: { search_session: "Ctrl+Shift+F" },
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

  it("accepts centralized session defaults settings updates", async () => {
    const app = createApp();
    const sessionDefaults = {
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
});
