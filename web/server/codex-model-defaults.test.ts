import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

const mockReadFile = vi.hoisted(() => vi.fn());
const mockGetLegacyCodexHome = vi.hoisted(() => vi.fn(() => "/tmp/codex-home"));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: mockReadFile,
  };
});

vi.mock("./codex-home.js", () => ({
  getLegacyCodexHome: mockGetLegacyCodexHome,
}));

import * as settingsManager from "./settings-manager.js";
import { createSettingsRoutes } from "./routes/settings.js";
import { createSystemRoutes, _resetModelCache } from "./routes/system.js";

describe("codex model defaults", () => {
  let app: Hono;
  let pathExists: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    _resetModelCache();
    pathExists = vi.fn(async () => false);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("no proxy"))),
    );

    const launcher = {
      listSessions: () => [],
      getSession: () => null,
      resolveSessionId: () => null,
    } as any;
    const wsBridge = {
      getSession: () => null,
    } as any;

    const systemCtx = {
      launcher,
      terminalManager: { getInfo: () => null, spawn: () => "", kill: () => {} },
      cronScheduler: undefined,
      recorder: undefined,
      perfTracer: undefined,
      WEB_DIR: "/tmp",
      wsBridge,
      sessionStore: { getSession: () => null },
      pathExists,
      resolveId: () => null,
    } as any;

    const settingsCtx = {
      launcher,
      wsBridge,
      options: undefined,
      pushoverNotifier: undefined,
    } as any;

    app = new Hono();
    app.route("/api", createSystemRoutes(systemCtx));
    app.route("/api", createSettingsRoutes(settingsCtx));
  });

  it("prefers Codex cache over LiteLLM proxy results", async () => {
    pathExists.mockResolvedValue(true);
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        models: [
          { slug: "gpt-5.5", display_name: "GPT-5.5", description: "Newest model", visibility: "list" },
          { slug: "gpt-5.4", display_name: "gpt-5.4", description: "Older model", visibility: "list" },
        ],
      }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: [{ id: "gpt-5.4" }, { id: "gpt-5" }, { id: "gpt-5-mini" }] }),
      })),
    );

    const res = await app.request("/api/backends/codex/models");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual([
      { value: "gpt-5.5", label: "GPT-5.5", description: "Newest model" },
      { value: "gpt-5.4", label: "gpt-5.4", description: "Older model" },
    ]);
  });

  it("falls back to LiteLLM proxy models when the Codex cache is missing", async () => {
    pathExists.mockResolvedValue(false);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: [{ id: "gpt-5.4" }, { id: "gpt-5.3-codex" }, { id: "gpt-5-mini" }, { id: "gpt-4.1" }],
        }),
      })),
    );

    const res = await app.request("/api/backends/codex/models");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual([
      { value: "gpt-5-mini", label: "GPT 5 Mini", description: "" },
      { value: "gpt-5.4", label: "GPT 5.4", description: "" },
      { value: "gpt-5.3-codex", label: "GPT 5.3 Codex", description: "" },
    ]);
  });

  it("returns the Codex config default model from the dedicated settings endpoint", async () => {
    vi.spyOn(settingsManager, "getCodexUserDefaultModel").mockResolvedValue("gpt-5.5");

    const res = await app.request("/api/settings/codex-default-model");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ model: "gpt-5.5" });
  });
});
