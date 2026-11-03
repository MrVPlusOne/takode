import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { _flushForTest, _resetForTest } from "../settings-manager.js";
import { createGlossaryRoutes } from "./glossary.js";

function makeApp() {
  const app = new Hono();
  app.route("/", createGlossaryRoutes());
  return app;
}

async function opened(app: Hono): Promise<boolean> {
  return ((await (await app.request("/glossary/opened")).json()) as { opened: boolean }).opened;
}

// The sidebar highlights its Glossary link until the user first opens the glossary. That state
// lives in the server's settings so every browser and device agrees, and it survives restarts.
describe("glossary opened state", () => {
  let settingsPath: string;

  beforeEach(() => {
    // A disposable settings file, never the user's real one.
    settingsPath = join(tmpdir(), `takode-glossary-${randomUUID()}.json`);
    _resetForTest(settingsPath);
  });

  afterEach(async () => {
    await rm(settingsPath, { force: true });
  });

  it("starts unopened, records the first opening and keeps it after a reload", async () => {
    const app = makeApp();
    expect(await opened(app)).toBe(false);

    const res = await app.request("/glossary/opened", { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ opened: true });
    expect(await opened(app)).toBe(true);

    // Opening again is harmless.
    await app.request("/glossary/opened", { method: "POST" });
    expect(await opened(app)).toBe(true);

    // A restarted server reads the saved settings file and still knows.
    await _flushForTest();
    _resetForTest(settingsPath);
    expect(await opened(makeApp())).toBe(true);
  });
});
