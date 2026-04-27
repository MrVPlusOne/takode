import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQuestRoutes } from "./routes/quests.js";
import * as questStore from "./quest-store.js";
import { SHARP_UNAVAILABLE_MESSAGE, SharpUnavailableError } from "./image-store.js";

function makeApp() {
  const app = new Hono();
  app.route(
    "/api",
    createQuestRoutes({
      launcher: {
        getSession: vi.fn(() => null),
      } as any,
      wsBridge: {
        getSession: vi.fn(() => null),
        broadcastToSession: vi.fn(),
        persistSessionById: vi.fn(),
      } as any,
      imageStore: undefined,
      authenticateCompanionCallerOptional: vi.fn(() => null),
      execCaptureStdoutAsync: vi.fn(),
    } as any),
  );
  return app;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("quest image upload routes", () => {
  it("returns 503 from /api/quests/_images when sharp is unavailable", async () => {
    vi.spyOn(questStore, "saveQuestImage").mockRejectedValue(new SharpUnavailableError("resize images"));
    const app = makeApp();
    const form = new FormData();
    form.append("file", new File([new Uint8Array([1, 2, 3])], "quest.png", { type: "image/png" }));

    const res = await app.request("/api/quests/_images", {
      method: "POST",
      body: form,
    });

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: SHARP_UNAVAILABLE_MESSAGE });
  });

  it("returns 503 from /api/quests/:questId/images when sharp is unavailable", async () => {
    vi.spyOn(questStore, "saveQuestImage").mockRejectedValue(new SharpUnavailableError("resize images"));
    const app = makeApp();
    const form = new FormData();
    form.append("file", new File([new Uint8Array([1, 2, 3])], "quest.png", { type: "image/png" }));

    const res = await app.request("/api/quests/q-928/images", {
      method: "POST",
      body: form,
    });

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: SHARP_UNAVAILABLE_MESSAGE });
  });
});
